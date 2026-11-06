# EvidenceBridge 🩺 | AI-Powered Healthcare Data Trust & Claims Intelligence

**Connecting hospital discovery, emergency coordination, clinical evidence verification and healthcare claims intelligence.**

EvidenceBridge is an AI-powered healthcare platform designed to improve transparency, accessibility and trust across the healthcare ecosystem. Initially focused on Karnataka, India, it brings patients, hospitals and healthcare data intelligence together in one connected application.

Healthcare information is often fragmented across hospital directories, medical bills, prescriptions, clinical records and medical guidelines. EvidenceBridge aims to make this information easier to access, examine and understand through AI-assisted document processing, evidence verification, pricing analysis, anomaly detection and regional insights.

---

## 🌟 What EvidenceBridge Does

EvidenceBridge connects two major experiences:

- **Patient Portal:** Discover hospitals, view reported staff availability, access healthcare information and submit emergency SOS requests.
- **Hospital Portal:** Manage hospital availability, view incoming SOS requests and update emergency response status.
- **Healthcare Intelligence:** Examine medical documents, retrieve supporting evidence, review clinical findings and identify potential billing irregularities.

The platform is designed to support better-informed decisions. It does not replace qualified medical professionals, emergency services or human claim reviewers.

---

## 🏥 1. Hospital Discovery & Hospital Management

### Patient Hospital Finder

Patients can use the Hospital Finder to explore hospitals listed in the EvidenceBridge directory.

Key capabilities include:

- Browse hospitals across Karnataka.
- Search and explore available hospital information.
- View reported doctor availability.
- View reported emergency doctor availability.
- View reported nurse availability.
- Check hospital duty status.
- See when availability information was last updated.
- Access hospital information to support their selection.

Availability information depends on updates submitted by participating hospitals. It should not be interpreted as a guarantee of immediate treatment capacity.

### Hospital Management Portal

Hospitals have a dedicated management interface to manage their information and operational availability.

Hospital-side capabilities include:

- Update the number of currently available doctors.
- Update emergency doctor availability.
- Update nurse availability.
- Update hospital duty status.
- Maintain availability information for patient visibility.
- View incoming emergency SOS requests.
- Acknowledge SOS requests.
- Update request progress and resolution status.

Hospital updates are intended to improve transparency between healthcare providers and patients.

---

## 🚨 2. Emergency SOS & Hospital Coordination

EvidenceBridge includes an SOS workflow designed to help patients or guardians communicate an emergency request to a selected participating hospital.

### Patient-side workflow

1. Open the Hospital Finder.
2. Select a hospital.
3. Choose the emergency category.
4. Add an optional description.
5. Share location when the feature is available and permission is granted.
6. Submit the SOS request.
7. Track the request status.

### Hospital-side workflow

1. Receive an incoming SOS request in the hospital dashboard.
2. Review the emergency details.
3. Acknowledge the request.
4. Update the response status.
5. Mark the request as resolved when appropriate.

### Emergency safety

The SOS workflow is intended to complement emergency services, not replace them.

In India, users should call **112** for emergency assistance. EvidenceBridge must not be treated as an ambulance dispatch service or a guaranteed emergency-response channel.

The platform's potential to support faster coordination and improve emergency outcomes requires real-world evaluation and clinical validation. No increase in patient survival rates is claimed.

---

## 📄 3. Intelligent Healthcare Document Processing

EvidenceBridge processes healthcare documents to identify relevant information for further review.

Depending on the document and supported extraction pipeline, information may include:

- Patient and hospital details.
- Diagnosis information.
- Medicines and prescriptions.
- Procedures and treatment details.
- Clinical codes.
- Billed amounts and billing line items.
- Supporting medical evidence.

The extracted information is presented for review rather than treated as automatically verified truth.

---

## 🔍 4. Clinical Evidence Verification

EvidenceBridge connects extracted healthcare information with relevant clinical references and supporting evidence.

The verification workflow helps reviewers understand:

- Whether relevant clinical guidelines were found.
- Whether the available evidence supports the documented treatment.
- Whether evidence is partial or contradictory.
- Whether more information is required.
- Why a particular result was produced.

The system can distinguish between:

- Supported
- Partially supported
- Contradicted
- Insufficient evidence

The purpose is to make healthcare claim reviews more transparent and traceable.

---

## 💰 5. Healthcare Cost Analysis

EvidenceBridge examines billed charges against available pricing benchmarks.

The system aims to identify:

- Potentially unusual charges.
- Differences between billed amounts and available benchmark ranges.
- Possible pricing discrepancies.
- Missing pricing references.
- Items that require additional human review.

A pricing alert is an indicator for investigation, not proof of overcharging or fraud. Where no suitable benchmark exists, the system should communicate that limitation rather than inventing a comparison.

---

## 🧠 6. Five-Model Healthcare Audit Workflow

EvidenceBridge brings together multiple stages of document understanding and claim analysis.

The audit workflow is presented through a structured sequence:

1. **Document Utilization:** Extract relevant information from uploaded healthcare documents.
2. **Medicine Information:** Identify medicine names and related details.
3. **Diagnosis Information:** Examine diagnosis and clinical information.
4. **Bill Cost Analysis:** Examine billed amounts and available pricing references.
5. **Anomaly Detection:** Identify unusual patterns requiring further review.
6. **Audit Summary:** Present the findings in a consolidated, understandable format.

The application also maintains a traceable audit process, helping users understand how information moves through the verification workflow.

Machine-learning and language-processing components support different parts of the system. Their outputs must be interpreted within the limits of their training data and evaluation.

---

## 🛡️ 7. Explainable Audit Trail & Evidence Integrity

EvidenceBridge aims to make audit decisions easier to inspect.

Its audit architecture includes:

- Document extraction.
- SHA-256 document provenance.
- Clinical evidence retrieval.
- Pricing analysis.
- Clinical verification.
- Safety and abstention checks.
- Final audit action.

The seven-stage decision record helps reviewers understand what information was considered, what evidence was used or discarded, and why a result was flagged or held.

When evidence is missing, conflicting or insufficient, the system should avoid presenting an unsupported conclusion.

---

## 📊 8. Insights & Regional Healthcare Intelligence

The Insights dashboard converts healthcare records and audit results into understandable visual summaries.

The dashboard focuses on five main areas:

### 1. Karnataka Hospital Coverage
Shows hospital distribution across districts and taluks, helping users understand the geographical coverage of the hospital directory.

### 2. Evidence Quality
Shows whether healthcare records contain complete, partial or missing supporting information.

### 3. Anomaly Detection
Displays the number of records evaluated and the number flagged for further review. An anomaly flag is not confirmation of fraud.

### 4. Clinical & Financial Audit Results
Summarizes clinical evidence findings and potential pricing issues, keeping these two types of results distinct.

### 5. Hospital Availability & SOS Insights
Provides visibility into reported staff availability and SOS request activity, including acknowledgement information when real records are available.

The dashboard should use actual application data. Where sufficient data is not available, it should display an appropriate empty state rather than fabricated statistics.

---

## 🎙️ 9. Bilingual AI Voice Assistant

EvidenceBridge includes a voice assistant designed to make the application easier to navigate.

The interface supports English and Kannada.

Depending on the configured ElevenLabs agent and application integration, supported interactions include:

- Navigate to Audit Claim.
- Open Hospitals.
- Find hospitals.
- Open Insights.
- Read available audit results.
- Explain why a record was flagged.
- Explain a potential pricing issue.
- Repeat the previous response.

The assistant is intended to use information available in the application and should not invent patient, hospital or audit information.

Voice access does not replace professional medical advice or emergency services.

---

## 🏗️ Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, TypeScript |
| Backend | Python, FastAPI |
| Database | MongoDB |
| Vector Database | ChromaDB |
| Machine Learning | Scikit-learn |
| Anomaly Detection | Isolation Forest |
| Cost Prediction | Random Forest (experimental) |
| Clinical NLP | Clinical language-processing models and NLP pipelines |
| Evidence Integrity | SHA-256 hashing |
| Voice AI | ElevenLabs Conversational AI |
| Visualization | Existing frontend charting components |

---

## 🔄 How EvidenceBridge Works

```text
                 PATIENT PORTAL
                       |
          +------------+------------+
          |                         |
     Find Hospitals             Audit Claim
          |                         |
  View Staff Availability    Upload Medical Document
          |                         |
      Send SOS               Extract Information
          |                         |
          v                         v
                 HOSPITAL PORTAL
                       |
             Receive SOS Request
                       |
             Acknowledge Request
                       |
             Update Response Status


              HEALTHCARE INTELLIGENCE
                       |
              Clinical Evidence
                       |
               Cost Analysis
                       |
              Anomaly Detection
                       |
               Audit Summary
                       |
              Insights Dashboard
```

---

## 🎯 What Makes EvidenceBridge Different?

EvidenceBridge connects multiple healthcare workflows rather than focusing on only one isolated task.

| Capability | EvidenceBridge |
|---|---|
| Hospital discovery | Yes |
| Hospital staff availability | Hospital-side updates and patient visibility |
| SOS coordination | Patient request and hospital acknowledgement workflow |
| Healthcare document extraction | AI-assisted extraction |
| Clinical evidence verification | Evidence-based review |
| Healthcare cost analysis | Benchmark-based pricing checks |
| Anomaly detection | Machine-learning-assisted screening |
| Audit traceability | Structured audit trail and SHA-256 provenance |
| Regional intelligence | Karnataka-focused hospital and data insights |
| Voice interaction | English and Kannada support |

The combination of these capabilities is intended to connect patient access, hospital coordination and healthcare data trust in one platform.

---

## 🌍 Expected Impact

EvidenceBridge aims to:

- Make hospital information easier to discover.
- Improve visibility into reported hospital staff availability.
- Support communication between patients, guardians and participating hospitals.
- Reduce the effort involved in reviewing healthcare documents.
- Make clinical evidence easier to inspect.
- Help identify unusual healthcare billing patterns.
- Improve transparency in healthcare audit decisions.
- Support regional healthcare data analysis.
- Explore whether better emergency coordination can contribute to improved patient outcomes through future validation.

These are project goals. Actual improvements in review time, emergency response and patient outcomes must be measured through appropriate testing and real-world evaluation.

---

## 🔐 Responsible Use & Safety

EvidenceBridge is a healthcare information and decision-support platform.

- It does not replace doctors or qualified healthcare professionals.
- It does not independently diagnose patients.
- It does not automatically establish medical fraud.
- It does not guarantee hospital availability or emergency response.
- SOS functionality does not replace calling India's emergency number 112.
- AI-generated or machine-learning-assisted findings require appropriate human review.
- Private API keys, database credentials and authentication secrets must never be committed to GitHub.

---

## 🚀 Running the Project Locally

### Prerequisites

- Python 3.11+
- Node.js 18+
- npm
- MongoDB, if using a persistent database
- Ollama, if required by the configured local AI services

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd evidencebridge
```

### 2. Set up the backend

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

Start the backend:

```powershell
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend API documentation:

`http://localhost:8000/docs`

### 3. Set up the frontend

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open:

`http://localhost:5173`

### 4. Environment configuration

Create local environment files using the appropriate example files.

Configure the required API URLs, database settings and application credentials locally.

For the ElevenLabs integration, configure the public Conversational AI Agent ID using:

```env
VITE_ELEVENLABS_AGENT_ID=YOUR_PUBLIC_AGENT_ID
```

Never put an ElevenLabs private API key in a `VITE_` variable or commit it to GitHub. A `VITE_` variable is exposed to the browser.

---

## 🧪 Testing & Validation

Testing should cover:

- Patient and hospital authentication.
- Hospital availability updates.
- Patient-facing availability information.
- SOS request creation.
- Hospital acknowledgement and status updates.
- Document extraction.
- Clinical evidence retrieval.
- Pricing analysis.
- Anomaly detection.
- Audit trail generation.
- Insights data accuracy.
- English and Kannada voice interactions.

Build success and code-level verification should be distinguished from actual end-to-end testing. Live emergency coordination and patient outcome improvements require separate real-world validation.

---

## 🔭 Future Scope

- Expand hospital coverage across additional regions.
- Improve hospital availability freshness and verification.
- Integrate additional hospital communication channels.
- Evaluate emergency coordination workflows with participating hospitals.
- Expand clinical guideline and pricing benchmark coverage.
- Improve document extraction and clinical language models.
- Conduct controlled testing of manual versus AI-assisted claim review.
- Evaluate emergency response time and patient outcomes using ethically approved, appropriately collected data.

---

## 💡 Our Vision

To build a more connected and trustworthy healthcare ecosystem where patients can discover hospitals, hospitals can communicate more effectively, and healthcare information can be examined through transparent, evidence-based processes.

**EvidenceBridge — Connecting Healthcare Data, Building Trust, Supporting Better Decisions.**
DEMO LINK - https://drive.google.com/file/d/1yvLPMduvIJoHx4u-snhtYbwdpeebvq-o/view?usp=drivesdk