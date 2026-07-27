# Automated Attendance System

An automated, web-based classroom attendance system that uses dynamic QR codes and local router network identification to make tracking attendance fast, secure, and hassle-free.

## Features

- **Dynamic QR Code Generation:** Generates a real-time QR code linked to the teacher's current local network IP.
- **PIN-Protected Sessions:** Ensures students check in only by scanning the active display (and not by sharing URLs).
- **Auto-Registration:** First-time students register their roll numbers and names automatically during check-in.
- **Server-Sent Events (SSE):** Real-time dashboard updates for teachers as students check in.
- **Proxy Detection & Security:** Checks client IP address and user-agent string to prevent students from submitting attendance for their classmates.
- **No Internet Required:** Works entirely on a local router/Wi-Fi network.

## Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** HTML5, CSS3 (Vanilla), Vanilla JS
- **Real-time Communication:** Server-Sent Events (SSE)
- **Database:** Local JSON files (`data/attendance.json`, `data/students.json`)

## Getting Started

### Prerequisites

- Node.js installed on your machine.
- A local network (Wi-Fi router) that both the host (teacher) and clients (students) are connected to.

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd automated-attendance
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Open the teacher dashboard in your browser:
   ```
   http://localhost:3000/teacher.html
   ```

## License

MIT License
