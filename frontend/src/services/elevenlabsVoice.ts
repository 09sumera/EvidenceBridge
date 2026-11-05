/**
 * EvidenceBridge – ElevenLabs Voice AI Engine
 * 
 * Provides real-time bidirectional Conversational AI using ElevenLabs WebSockets.
 * Follows security requirements:
 * - Uses Public Agent ID (VITE_ELEVENLABS_AGENT_ID) with zero client-side secret leakage.
 * - Streams 16kHz PCM audio from microphone.
 * - Receives and schedules ElevenLabs synthesized audio chunks via Web Audio API.
 * - Handles interruptions, real-time transcripts, and status transitions.
 */

export interface ElevenLabsVoiceOptions {
  agentId?: string
  language?: 'en' | 'kn'
  onStatusChange?: (status: 'idle' | 'listening' | 'thinking' | 'speaking') => void
  onTranscript?: (transcript: string, isFinal: boolean) => void
  onAgentResponse?: (text: string) => void
  onError?: (error: string) => void
  dynamicVariables?: Record<string, string>
}

export class ElevenLabsVoiceEngine {
  private ws: WebSocket | null = null
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private processorNode: ScriptProcessorNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private isConnected = false
  private isListening = false
  private audioQueue: AudioBufferSourceNode[] = null as any
  private nextPlaybackTime = 0
  private options: ElevenLabsVoiceOptions = {}
  private transcriptDebounceTimer: any = null
  private latestTranscript = ''

  constructor() {
    this.audioQueue = []
  }

  /**
   * Check if ElevenLabs Agent ID is configured
   */
  public static getAgentId(): string {
    const envAgentId = (import.meta as any).env?.VITE_ELEVENLABS_AGENT_ID
    if (envAgentId && typeof envAgentId === 'string' && envAgentId.trim() && !envAgentId.includes('placeholder')) {
      return envAgentId.trim()
    }
    // Return empty if not yet provided by the user
    return ''
  }

  /**
   * Start bidirectional ElevenLabs Conversational AI session
   */
  public async startSession(options: ElevenLabsVoiceOptions = {}): Promise<void> {
    this.options = options
    const agentId = options.agentId || ElevenLabsVoiceEngine.getAgentId()

    if (!agentId) {
      options.onError?.('ElevenLabs Agent ID not configured. Please configure VITE_ELEVENLABS_AGENT_ID with your public ElevenLabs Agent ID.')
      options.onStatusChange?.('idle')
      return
    }

    try {
      options.onStatusChange?.('thinking')

      // 1. Initialize AudioContext for microphone and playback
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx({ sampleRate: 16000 })
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      // 2. Request Microphone Access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      // 3. Connect to ElevenLabs Conversational AI WebSocket
      // Secure Public Agent endpoint: wss://api.elevenlabs.io/v1/convai/conversation?agent_id={agent_id}
      const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}`
      this.ws = new WebSocket(wsUrl)
      this.audioQueue = []
      this.nextPlaybackTime = this.audioContext.currentTime

      this.ws.onopen = () => {
        this.isConnected = true
        this.isListening = true
        options.onStatusChange?.('listening')

        // Send conversation initiation payload
        const initPayload = {
          type: 'conversation_initiation_client_data',
          conversation_config_override: {
            agent: {
              language: options.language === 'kn' ? 'kn' : 'en',
            },
          },
          dynamic_variables: {
            app_name: 'EvidenceBridge',
            user_role: 'patient',
            language: options.language === 'kn' ? 'kn' : 'en',
            ...(options.dynamicVariables || {}),
          },
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(initPayload))
        }

        // Start streaming microphone PCM chunks
        this.startMicrophoneStreaming()
      }

      this.ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data)
          this.handleServerEvent(data)
        } catch {
          // Ignore binary or non-json frame
        }
      }

      this.ws.onerror = () => {
        options.onError?.('ElevenLabs connection error. Please verify network access and Agent ID.')
        this.stopSession()
      }

      this.ws.onclose = () => {
        this.isConnected = false
        this.isListening = false
        this.stopMicrophoneStreaming()
        options.onStatusChange?.('idle')
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        options.onError?.('Microphone permission denied. Please allow microphone access in your browser.')
      } else {
        options.onError?.(err?.message || 'Failed to initialize ElevenLabs Voice session.')
      }
      this.stopSession()
    }
  }

  /**
   * Stream 16kHz PCM audio chunks from browser microphone to ElevenLabs
   */
  private startMicrophoneStreaming() {
    if (!this.audioContext || !this.mediaStream) return

    try {
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
      // Buffer size 2048 at 16kHz ≈ 128ms chunks
      this.processorNode = this.audioContext.createScriptProcessor(2048, 1, 1)

      this.processorNode.onaudioprocess = (e) => {
        if (!this.isListening || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return
        }

        const inputData = e.inputBuffer.getChannelData(0)
        // Convert Float32Array to 16-bit PCM Int16Array
        const pcm16 = new Int16Array(inputData.length)
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]))
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }

        // Convert Int16Array to Base64
        const uint8 = new Uint8Array(pcm16.buffer)
        let binary = ''
        const len = uint8.byteLength
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(uint8[i])
        }
        const b64 = btoa(binary)

        // Send audio chunk to ElevenLabs WebSocket
        this.ws.send(
          JSON.stringify({
            user_audio_chunk: b64,
          })
        )
      }

      this.sourceNode.connect(this.processorNode)
      this.processorNode.connect(this.audioContext.destination)
    } catch {
      // Audio stream node failed
    }
  }

  /**
   * Stop microphone streaming nodes
   */
  private stopMicrophoneStreaming() {
    if (this.processorNode) {
      try {
        this.processorNode.disconnect()
      } catch {}
      this.processorNode = null
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect()
      } catch {}
      this.sourceNode = null
    }
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((t) => t.stop())
      } catch {}
      this.mediaStream = null
    }
  }

  /**
   * Handle incoming ElevenLabs WebSocket messages
   */
  private handleServerEvent(data: any) {
    if (!data) return

    // 1. User Transcript (Real-time Speech Recognition from ElevenLabs)
    if (data.type === 'user_transcript' && data.user_transcription_event) {
      const text = (data.user_transcription_event.user_transcript || '').trim()
      if (!text) return

      this.latestTranscript = text
      const explicitFinal = data.user_transcription_event.is_final === true

      if (this.transcriptDebounceTimer) {
        clearTimeout(this.transcriptDebounceTimer)
        this.transcriptDebounceTimer = null
      }

      if (explicitFinal) {
        // Immediate final recognized sentence
        this.options.onTranscript?.(text, true)
      } else {
        // Live partial transcription immediately as words are spoken
        this.options.onTranscript?.(text, false)

        // Set short speech pause debounce to finalize when user stops speaking
        this.transcriptDebounceTimer = setTimeout(() => {
          if (this.latestTranscript) {
            this.options.onTranscript?.(this.latestTranscript, true)
          }
          this.transcriptDebounceTimer = null
        }, 500)
      }
      return
    }

    // 2. Agent Response (Assistant Answer Text)
    if (data.type === 'agent_response' && data.agent_response_event) {
      // If user speech hasn't finalized yet, finalize before assistant response
      if (this.transcriptDebounceTimer) {
        clearTimeout(this.transcriptDebounceTimer)
        this.transcriptDebounceTimer = null
        if (this.latestTranscript) {
          this.options.onTranscript?.(this.latestTranscript, true)
        }
      }

      const text = data.agent_response_event.agent_response || ''
      if (text.trim()) {
        this.options.onAgentResponse?.(text.trim())
      }
      return
    }

    // 3. Audio Chunk from ElevenLabs
    if (data.type === 'audio' && data.audio_event?.audio_base_64) {
      this.options.onStatusChange?.('speaking')
      this.enqueueAudioChunk(data.audio_event.audio_base_64)
      return
    }

    // 4. User Interruption
    if (data.type === 'interruption') {
      this.clearAudioQueue()
      this.options.onStatusChange?.('listening')
      return
    }

    // 5. Ping / Pong
    if (data.type === 'ping' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'pong', event_id: data.ping_event?.event_id }))
    }
  }

  /**
   * Decode and schedule incoming base64 PCM audio chunk
   */
  private async enqueueAudioChunk(base64Data: string) {
    if (!this.audioContext) return

    try {
      const binaryString = atob(base64Data)
      const len = binaryString.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      // Check if PCM 16kHz (2 bytes per sample)
      const pcm16 = new Int16Array(bytes.buffer)
      const numSamples = pcm16.length
      if (numSamples <= 0) return

      const audioBuffer = this.audioContext.createBuffer(1, numSamples, 16000)
      const channelData = audioBuffer.getChannelData(0)
      for (let i = 0; i < numSamples; i++) {
        channelData[i] = pcm16[i] / 32768.0
      }

      const source = this.audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.audioContext.destination)

      const currentTime = this.audioContext.currentTime
      const startTime = Math.max(currentTime, this.nextPlaybackTime)
      source.start(startTime)
      this.nextPlaybackTime = startTime + audioBuffer.duration

      this.audioQueue.push(source)
      source.onended = () => {
        const idx = this.audioQueue.indexOf(source)
        if (idx !== -1) {
          this.audioQueue.splice(idx, 1)
        }
        if (this.audioQueue.length === 0 && this.audioContext && this.audioContext.currentTime >= this.nextPlaybackTime) {
          if (this.isListening) {
            this.options.onStatusChange?.('listening')
          } else {
            this.options.onStatusChange?.('idle')
          }
        }
      }
    } catch {
      // Audio decoding skipped
    }
  }

  /**
   * Stop scheduled audio playback immediately upon user interruption
   */
  public clearAudioQueue() {
    for (const source of this.audioQueue) {
      try {
        source.stop()
        source.disconnect()
      } catch {}
    }
    this.audioQueue = []
    if (this.audioContext) {
      this.nextPlaybackTime = this.audioContext.currentTime
    }
  }

  /**
   * Stop active ElevenLabs session and release resources
   */
  public stopSession() {
    this.isListening = false
    this.isConnected = false
    if (this.transcriptDebounceTimer) {
      clearTimeout(this.transcriptDebounceTimer)
      this.transcriptDebounceTimer = null
    }
    this.latestTranscript = ''
    this.stopMicrophoneStreaming()
    this.clearAudioQueue()

    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }

    this.options.onStatusChange?.('idle')
  }

  /**
   * Send text prompt directly to active session
   */
  public sendUserMessage(text: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'user_message',
          user_message: text,
        })
      )
    }
  }

  /**
   * Check if session is currently active
   */
  public isActive(): boolean {
    return this.isConnected
  }
}

// Global singleton engine instance
export const elevenLabsVoice = new ElevenLabsVoiceEngine()
