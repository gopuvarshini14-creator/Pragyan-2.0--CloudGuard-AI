# [Project Name]

Cloud Cost Optimization Autonomous Agent

## 1. Team Details

**Team Name / ID:** Team Gopu Varshini 
**Team Lead:** Gopu Varshini

**Team Members:**
- [Gopu Varshini]  | [Developer]
- [Avunoori Akshaya] | [Developer]
- [Basina Harathi] | [Developer]



**Repo Link (Optional):** [Link, or N/A]

**Demo Link (Optional):** [Link, or N/A]

---

## 2. Problem Statement


Build an autonomous cloud cost-optimization agent that monitors a simulated cloud environment, investigates unexpected spending, chooses safe actions, executes them through APIs, and verifies whether the action actually improved the situation. The agent receives natural-language requests and structured cloud state. AI must play a meaningful role in deciding what to investigate and what action to take; deterministic backend code must enforce safety constraints.

---

## 3. TL;DR


**Problem:**  Cloud bills increase because some services use more resources than needed.


**Solution:** Our AI agent finds wasted resources, safely adjusts cloud services, and checks the results.

**Who benefits:** Cloud teams save money while keeping their services fast and reliable.


## 4. Scope of the Project

**What are you building?**

We are building an AI-powered cloud cost optimization agent that monitors service usage, traffic, latency, health, instance count, and cost. It identifies unnecessary resource usage, chooses safe actions like scaling up/down or stopping idle services, and verifies the result.

**How does it solve the problem statement?**

The agent investigates why cloud costs are increasing, makes intelligent cost-saving decisions, follows safety limits, handles stale data and failed actions, and verifies every action to ensure cost is reduced without affecting performance or availability.

**Key features you're building for this hackathon:**

- AI detects idle cloud resources causing unnecessary costs.
- Smart recommendations for auto-scaling and right-sizing.
- Real-time dashboard showing current costs and savings.
- Upload AWS/Azure/GCP usage reports for instant analysis.
- Download optimization reports with estimated monthly savings.

**What are you deliberately NOT doing? (Optional)**

We are not connecting to real AWS, Azure, or Google Cloud accounts. We use uploaded cloud reports instead, and the AI only gives recommendations instead of making automatic changes.


## 5. Why an Agentic Approach?

Our solution uses an AI agent because cloud cost optimization requires multiple decisions, not just answering questions. The agent analyzes uploaded cloud usage reports, identifies idle resources, compares CPU, memory, and cost patterns, estimates potential savings, and generates personalized optimization recommendations. Instead of simply displaying data, it reasons through the problem step by step and produces an actionable cost-saving report, similar to how a cloud engineer would investigate a billing issue.

**What does your agent decide or do on its own?**

Our agent automatically reads the uploaded cloud usage report, identifies idle or oversized resources, calculates potential cost savings, prioritizes the best optimization actions, and generates a personalized report. If data is missing or incomplete, it adjusts its analysis and provides the best possible recommendations instead of stopping.

**Why wouldn't a fixed script, if-else rules, or a simple chatbot be enough?**

A fixed script or if-else rules can only handle predefined cases. Cloud usage patterns vary across services, workloads, and costs, so the agent must analyze different combinations of metrics, decide which optimization is most effective, estimate savings, and explain its reasoning. A simple chatbot cannot perform this multi-step analysis and decision-making.


## 6. Who It's For & What Changes

**Who or what is this for?**

- Startups
- DevOps teams
- cloud engineers
- IT managers
- Businesses using AWS, Azure, or Google Cloud.

**The world today, without your solution:**

Companies often spend more on cloud services because idle servers, oversized resources, and unused storage go unnoticed. Teams manually check dashboards, compare reports, and investigate billing issues, which takes time and can lead to unnecessary monthly cloud expenses.

**The world with your solution, fully built and scaled to production:**

Companies receive continuous AI-powered cloud cost monitoring with automatic detection of wasted resources, personalized optimization suggestions, and real-time savings insights. Teams spend less time investigating bills while reducing cloud costs through smarter infrastructure decisions.

**What your hackathon build actually delivers today:**

Our hackathon MVP allows users to upload a cloud usage report (CSV), analyzes CPU, memory, server count, and costs, detects idle or oversized resources, estimates potential savings, and generates an AI-powered dashboard with optimization recommendations and a downloadable PDF report.


**Before vs. After**

| What Changes           | Today                            | With Our Current Build    | At Production Scale              |
| ---------------------- | -------------------------------- | ------------------------- | -------------------------------- |
| Finding idle resources | Manual checking of cloud reports | AI detects idle resources | Continuous automatic detection   |
| Time to analyze costs  | 30–60 minutes manually           | Under 1 minute            | Real-time monitoring             |
| Cost optimization      | Manual investigation             | AI gives recommendations  | Automated optimization workflows |
| Cost reporting         | Manual reports and calculations  | Dashboard + PDF report    | Live organization-wide reports   |


## 7. Architecture & Agents

Basic architecture

User
  ↓
Upload Cloud Usage CSV
  ↓
Data Processing Agent
  ↓
Cloud Cost Analysis Agent
  ↓
Optimization Recommendation Agent
  ↓
Savings Calculation
  ↓
Dashboard + PDF Report

Our system uses multiple specialized AI agents connected through a simple workflow. The user first uploads a cloud usage CSV. The Data Processing Agent validates and extracts the required metrics. The Cost Analysis Agent identifies idle or oversized resources. The Optimization Agent selects suitable cost-saving actions and prioritizes them. Finally, the Savings & Report Agent estimates savings and generates the dashboard and PDF report. The agents work together to turn raw cloud usage data into actionable cost-optimization recommendations.


**How is your system put together?**

Users upload a cloud usage CSV through the web interface. A Data Processing Agent validates and extracts the metrics, a Cost Analysis Agent detects idle or oversized resources, and an Optimization Agent recommends cost-saving actions. A Savings & Report Agent calculates potential savings and presents the results through a dashboard and PDF report.


### 7.1 Agents

* **Data Processing Agent:** Validates the uploaded CSV and extracts cloud usage metrics. Uses GPT-5.6 because it handles varied data and reasoning well. Talks to the web app and Analysis Agent.

* **Cost Optimization Agent:** Detects idle/oversized resources, estimates savings, and recommends actions. Uses GPT-5.6 for multi-step reasoning. Talks to the Data Agent, calculation service, and Report Agent.


### 7.2 Services, APIs, Databases & Memory

* **Web App (Streamlit):** Lets users upload cloud CSV files and view optimization results and savings.

* **CSV/Data Processor:** Reads and validates uploaded cloud usage data for the agents.

* **Calculation Service:** Calculates current cost, optimized cost, and estimated savings.

* **Report Generator:** Creates the dashboard data and downloadable PDF optimization report.


**How does your system remember things (memory & state)?**

Each uploaded report is processed as a separate analysis. Results are stored temporarily during the session so the dashboard and report can use the same analysis. No long-term user memory is required.


### 7.3 Example Walkthrough

**Example input:** A user uploads a CSV containing cloud services, CPU usage, memory usage, server count, and daily cost.

1. Web App: Accepts the CSV and sends it to the Data Processing Agent.

2. Data Processing Agent: Validates the file and extracts the required cloud metrics.

3. Cost Optimization Agent: Analyzes usage and identifies idle or oversized resources.

4. Cost Optimization Agent: Recommends actions such as reducing servers or enabling auto-scaling.

5. Calculation Service: Calculates estimated optimized cost and potential savings.

6. Report Generator: Creates the dashboard results and PDF report.

Final output: A list of optimization recommendations with current cost, estimated optimized cost, and potential savings.


**Anything special about how your workflow runs? (Optional)**

The workflow uses a sequential agent process. First, the data is validated, then resources are analyzed and optimization actions are selected. Savings are calculated after recommendations are generated. The system also checks for missing or invalid data before producing the final report.


## 8. Tech Stack

| Layer                | Technology                    |
| -------------------- | ----------------------------- |
| Frontend / Interface | Streamlit                     |
| Backend              | Python                        |
| Agent Framework      | LangGraph                     |
| Database / Storage   | SQLite                        |
| Hosting              | Local machine                 |
| Other                | Pandas, OpenAI API, ReportLab |



| Layer | Technology |
|-------|------------|
| Frontend / Interface | [...] |
| Backend | [...] |
| Agent Framework | [e.g. LangGraph, CrewAI, AutoGen, custom code] |
| Database / Storage | [...] |
| Hosting | [e.g. local machine, cloud provider] |
| Other | [...] |


## 9. What to Expect From Our Current Build

Working:

* CSV upload, cloud usage analysis, cost calculations, recommendations, dashboard and PDF report.

Partly working, mocked, or hard-coded:

* Cloud data is provided through sample/uploaded CSV instead of live AWS/Azure/GCP APIs.

Not working or not built yet:

* Live cloud account integration and automatic infrastructure changes.

What we'd most like to be judged on:

Please focus on our agentic workflow: how the system analyzes cloud usage, identifies waste, prioritizes optimization actions, and estimates potential savings.




**Working:**

* CSV upload, cloud usage analysis, cost calculations, recommendations, dashboard and PDF report.


**Partly working, mocked, or hard-coded:**

* Cloud data is provided through sample/uploaded CSV instead of live AWS/Azure/GCP APIs.


**Not working or not built yet:**

* Live cloud account integration and automatic infrastructure changes.


**What we'd most like to be judged on:**

Please focus on our agentic workflow: how the system analyzes cloud usage, identifies waste, prioritizes optimization actions, and estimates potential savings.


## 10. Future Scope


### Idea 1

**Name:** Live Cloud Integration

**What it is:** Connect the agent directly to AWS, Azure, and Google Cloud to collect real-time usage and billing data.

**Why it matters:** Removes manual CSV uploads and enables continuous cloud cost monitoring.

**How we'd build it:** Use official cloud APIs to securely fetch billing, compute, storage, and utilization metrics.

**Done when:** A connected cloud account automatically provides fresh usage data to the agent.



### Idea 2

**Name:** Automated Optimization

**What it is:** Allow the agent to safely apply approved cost-saving actions to cloud resources.

**Why it matters:** Recommendations become actionable, reducing manual work for DevOps teams.

**How we'd build it:** Add permission-controlled cloud APIs, approval steps, safety checks, and rollback support.

**Done when:** A user approves an action and the agent safely applies it and verifies the result.


### Idea 3 (Optional)

**Name:** Continuous Cost Monitoring

**What it is:** Monitor cloud costs continuously and alert users when unusual spending or resource waste is detected.

**Why it matters:** Teams can catch unexpected cloud spending before it becomes a large bill.

**How we'd build it:** Schedule periodic cloud-metric collection and use the agent to detect anomalies and generate alerts.

**Done when:** The system detects a spending anomaly and sends a useful alert with its cause and recommendation.



## 11. Additional Notes (Optional)

Our MVP focuses on demonstrating the core agentic workflow rather than live cloud infrastructure control. The system converts cloud usage data into understandable cost insights, prioritized recommendations, estimated savings, and a clear report. Future versions can add secure cloud integrations and approved automated actions.


