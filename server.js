const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const PORT = 3000;

// Admin Security Setup
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || Math.floor(100000 + Math.random() * 900000).toString();
const ADMIN_SESSION_TOKEN = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

// Helper to parse cookies from headers
function getCookie(req, name) {
    const list = {};
    const rc = req.headers.cookie;
    if (rc) {
        rc.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            list[parts.shift().trim()] = decodeURI(parts.join('='));
        });
    }
    return list[name];
}

// Authentication middleware
function requireAuth(req, res, next) {
    const token = getCookie(req, 'admin_token');
    if (token === ADMIN_SESSION_TOKEN) {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    res.redirect('/login.html');
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Protect admin pages and scripts before exposing public static files
app.use((req, res, next) => {
    const isStudentRoute = req.path === '/' || 
                           req.path === '/index.html' || 
                           req.path === '/api/checkin' || 
                           req.path === '/api/login' ||
                           req.path === '/login.html' ||
                           req.path.startsWith('/css/') || 
                           req.path.startsWith('/js/main.js');
    
    if (!isStudentRoute) {
        return requireAuth(req, res, next);
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Ensure data folder exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');
const ATTENDANCE_FILE = path.join(DATA_DIR, 'attendance.json');

// Helper to read JSON
function readJSON(file, defaultVal = {}) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (e) {
        console.error(`Error reading ${file}:`, e);
    }
    return defaultVal;
}

// Helper to write JSON
function writeJSON(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`Error writing ${file}:`, e);
    }
}

// In-memory data initialized from files
let students = readJSON(STUDENTS_FILE, {});
let attendanceHistory = readJSON(ATTENDANCE_FILE, []);

// Active session state
let activeSession = null;
let pinRotationInterval = null;

// Clients subscribed to Server-Sent Events (SSE)
let sseClients = [];

// Rotate pin for active session
async function rotateSessionPin() {
    if (!activeSession) return;
    
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    activeSession.previousPin = activeSession.pin;
    activeSession.pin = newPin;
    activeSession.url = `http://${LOCAL_IP}:${PORT}/?session=${activeSession.id}&pin=${newPin}`;
    
    try {
        activeSession.qrCode = await QRCode.toDataURL(activeSession.url);
        broadcastSSE('session_update', {
            pin: activeSession.pin,
            qrCode: activeSession.qrCode,
            url: activeSession.url
        });
    } catch (err) {
        console.error('Failed to rotate session PIN:', err);
    }
}

// Helper to detect local IPv4 address
function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
}

const LOCAL_IP = getLocalIpAddress();

// Notify all SSE clients of a new check-in or session update
function broadcastSSE(type, data) {
    const message = `data: ${JSON.stringify({ type, data })}\n\n`;
    sseClients.forEach(client => client.write(message));
}

// API Endpoints

// 0. Login API for Teacher Dashboard
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.setHeader('Set-Cookie', `admin_token=${ADMIN_SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Lax`);
        return res.json({ success: true });
    }
    res.status(401).json({ error: 'Invalid password' });
});

// 1. Get current server state and local IP
app.get('/api/server-info', (req, res) => {
    res.json({
        localIp: LOCAL_IP,
        port: PORT,
        url: `http://${LOCAL_IP}:${PORT}`,
        activeSession: activeSession
    });
});

// 2. Start a new attendance session
app.post('/api/session/start', async (req, res) => {
    if (activeSession) {
        return res.status(400).json({ error: 'A session is already active.' });
    }

    const sessionId = Date.now().toString();
    const pin = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit temporary pin for extra security
    const checkinUrl = `http://${LOCAL_IP}:${PORT}/?session=${sessionId}&pin=${pin}`;

    try {
        const qrCodeDataUrl = await QRCode.toDataURL(checkinUrl);
        activeSession = {
            id: sessionId,
            startTime: new Date().toISOString(),
            pin: pin,
            previousPin: null,
            qrCode: qrCodeDataUrl,
            url: checkinUrl,
            records: [] // temporary in-memory store for fast lookup
        };

        // Start PIN rotation interval (rotates every 30 seconds)
        pinRotationInterval = setInterval(rotateSessionPin, 30000);

        broadcastSSE('session_start', activeSession);
        res.json({ message: 'Session started successfully', session: activeSession });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR Code' });
    }
});

// 3. Stop active session and save results to file
app.post('/api/session/stop', (req, res) => {
    if (!activeSession) {
        return res.status(400).json({ error: 'No active session to stop.' });
    }

    if (pinRotationInterval) {
        clearInterval(pinRotationInterval);
        pinRotationInterval = null;
    }

    const completedSession = {
        sessionId: activeSession.id,
        startTime: activeSession.startTime,
        endTime: new Date().toISOString(),
        records: activeSession.records
    };

    attendanceHistory.push(completedSession);
    writeJSON(ATTENDANCE_FILE, attendanceHistory);

    activeSession = null;
    broadcastSSE('session_stop', null);

    res.json({ message: 'Session stopped and saved successfully', history: completedSession });
});

// 4. Get active session state
app.get('/api/session/active', (req, res) => {
    res.json(activeSession);
});

// 5. Submit attendance (Mark presence or Register & Mark)
app.post('/api/checkin', (req, res) => {
    const { rollNumber, name, pin, sessionId } = req.body;
    
    // Attempt to get client IP cleanly, handling proxy headers if behind nginx or routing layers
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    if (clientIp.startsWith('::ffff:')) {
        clientIp = clientIp.substring(7); // Normalize IPv4-mapped IPv6 addresses
    }
    
    const userAgent = req.headers['user-agent'] || 'Unknown';

    if (!activeSession) {
        return res.status(400).json({ error: 'No active attendance session.' });
    }

    if (activeSession.id !== sessionId || (activeSession.pin !== pin && activeSession.previousPin !== pin)) {
        return res.status(400).json({ error: 'Invalid or expired session session/PIN link. Please scan the active QR Code.' });
    }

    if (!rollNumber || rollNumber.trim() === '') {
        return res.status(400).json({ error: 'Roll number is required.' });
    }

    const trimmedRoll = rollNumber.trim().toUpperCase();
    
    // Check if student is already checked in for this active session
    const alreadyCheckedIn = activeSession.records.find(r => r.rollNumber === trimmedRoll);
    if (alreadyCheckedIn) {
        return res.status(200).json({ 
            success: true, 
            already: true,
            student: { rollNumber: trimmedRoll, name: alreadyCheckedIn.name },
            message: 'You have already checked in.' 
        });
    }

    // Student Lookup or auto-registration
    let studentName = name ? name.trim() : '';
    if (!students[trimmedRoll]) {
        // If not registered and no name provided, request registration
        if (!studentName) {
            return res.status(404).json({ error: 'NOT_REGISTERED', message: 'First-time registration required.' });
        }
        // Register the student
        students[trimmedRoll] = {
            rollNumber: trimmedRoll,
            name: studentName,
            registeredAt: new Date().toISOString()
        };
        writeJSON(STUDENTS_FILE, students);
    } else {
        studentName = students[trimmedRoll].name;
    }

    // Proxy detection check
    let flagged = false;
    let flagReason = '';

    // Check if this IP is already used by another student in the active session
    // Note: ignore localhost IP loops if testing locally from the host itself
    if (clientIp !== '127.0.0.1' && clientIp !== '::1') {
        const ipConflict = activeSession.records.find(r => r.ip === clientIp && r.rollNumber !== trimmedRoll);
        if (ipConflict) {
            flagged = true;
            flagReason = `Proxy Alert: Shared IP (${clientIp}) with Roll ${ipConflict.rollNumber}`;
            
            // Also flag the conflict record retroactively so the teacher sees both are suspicious
            ipConflict.flagged = true;
            ipConflict.flagReason = `Proxy Alert: Shared IP (${clientIp}) with Roll ${trimmedRoll}`;
            
            // Broadcast the modification of the previous record to update teacher dashboard live
            broadcastSSE('checkin_flagged', ipConflict);
        }
    }

    const record = {
        rollNumber: trimmedRoll,
        name: studentName,
        timestamp: new Date().toISOString(),
        ip: clientIp,
        userAgent: userAgent,
        flagged: flagged,
        flagReason: flagReason
    };

    activeSession.records.push(record);
    
    // Broadcast checkin event via SSE
    broadcastSSE('checkin', record);

    res.json({ 
        success: true, 
        student: { rollNumber: trimmedRoll, name: studentName },
        message: 'Checked in successfully!' 
    });
});

// 6. SSE endpoint for real-time dashboard updates
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Establish stream

    sseClients.push(res);
    console.log(`Teacher dashboard connected to live feed. Client count: ${sseClients.length}`);

    // If there is an active session, send it to the newly connected client
    if (activeSession) {
        res.write(`data: ${JSON.stringify({ type: 'session_start', data: activeSession })}\n\n`);
    }

    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
        console.log(`Teacher dashboard disconnected. Client count: ${sseClients.length}`);
    });
});

// 7. Get attendance history
app.get('/api/history', (req, res) => {
    res.json(attendanceHistory);
});

// 8. Get all registered students
app.get('/api/students', (req, res) => {
    res.json(Object.values(students));
});

// 8a. Add student manually
app.post('/api/students/add', (req, res) => {
    const { rollNumber, name } = req.body;
    if (!rollNumber || !name) {
        return res.status(400).json({ error: 'Roll number and name are required.' });
    }
    const trimmedRoll = rollNumber.trim().toUpperCase();
    if (students[trimmedRoll]) {
        return res.status(400).json({ error: 'Student with this roll number already exists.' });
    }
    students[trimmedRoll] = {
        rollNumber: trimmedRoll,
        name: name.trim(),
        registeredAt: new Date().toISOString()
    };
    writeJSON(STUDENTS_FILE, students);
    broadcastSSE('students_update', Object.values(students));
    res.json({ message: 'Student registered successfully', student: students[trimmedRoll] });
});

// 8b. Update student details
app.post('/api/students/update', (req, res) => {
    const { oldRollNumber, newRollNumber, name } = req.body;
    if (!oldRollNumber || !newRollNumber || !name) {
        return res.status(400).json({ error: 'All fields are required.' });
    }
    const oldRoll = oldRollNumber.trim().toUpperCase();
    const newRoll = newRollNumber.trim().toUpperCase();
    const newName = name.trim();

    if (!students[oldRoll]) {
        return res.status(404).json({ error: 'Student not found.' });
    }

    if (oldRoll !== newRoll && students[newRoll]) {
        return res.status(400).json({ error: 'Conflict: New roll number is already used by another student.' });
    }

    const savedStudent = students[oldRoll];
    
    if (oldRoll !== newRoll) {
        delete students[oldRoll];
    }

    students[newRoll] = {
        rollNumber: newRoll,
        name: newName,
        registeredAt: savedStudent.registeredAt
    };
    
    writeJSON(STUDENTS_FILE, students);

    // Update active session records if they are checked in
    if (activeSession) {
        let recordUpdated = false;
        activeSession.records = activeSession.records.map(record => {
            if (record.rollNumber === oldRoll) {
                recordUpdated = true;
                return {
                    ...record,
                    rollNumber: newRoll,
                    name: newName
                };
            }
            return record;
        });

        if (recordUpdated) {
            broadcastSSE('session_start', activeSession); // refresh active session view on clients
        }
    }

    broadcastSSE('students_update', Object.values(students));
    res.json({ message: 'Student details updated successfully', student: students[newRoll] });
});

// 8c. Manual check-in by teacher
app.post('/api/checkin/manual', (req, res) => {
    const { rollNumber } = req.body;
    if (!activeSession) {
        return res.status(400).json({ error: 'No active attendance session.' });
    }
    if (!rollNumber) {
        return res.status(400).json({ error: 'Roll number is required.' });
    }
    const trimmedRoll = rollNumber.trim().toUpperCase();
    const student = students[trimmedRoll];
    if (!student) {
        return res.status(404).json({ error: 'Student not registered. Please register them first.' });
    }

    const alreadyCheckedIn = activeSession.records.find(r => r.rollNumber === trimmedRoll);
    if (alreadyCheckedIn) {
        return res.status(400).json({ error: 'Student already checked in.' });
    }

    const record = {
        rollNumber: trimmedRoll,
        name: student.name,
        timestamp: new Date().toISOString(),
        ip: 'MANUAL',
        userAgent: 'Teacher Panel',
        flagged: false,
        flagReason: ''
    };

    activeSession.records.push(record);
    broadcastSSE('checkin', record);
    res.json({ success: true, message: 'Checked in manually' });
});

// 8d. Remove check-in record
app.post('/api/checkin/remove', (req, res) => {
    const { rollNumber } = req.body;
    if (!activeSession) {
        return res.status(400).json({ error: 'No active attendance session.' });
    }
    const trimmedRoll = rollNumber.trim().toUpperCase();
    const initialLength = activeSession.records.length;
    activeSession.records = activeSession.records.filter(r => r.rollNumber !== trimmedRoll);
    
    if (activeSession.records.length === initialLength) {
        return res.status(404).json({ error: 'Record not found in current session.' });
    }

    broadcastSSE('session_start', activeSession); // refresh feed
    res.json({ success: true, message: 'Check-in record removed' });
});

// 9. Reset database endpoint (DANGER!)
app.post('/api/reset', (req, res) => {
    students = {};
    attendanceHistory = [];
    activeSession = null;
    writeJSON(STUDENTS_FILE, students);
    writeJSON(ATTENDANCE_FILE, attendanceHistory);
    broadcastSSE('reset', null);
    res.json({ message: 'System database cleared successfully.' });
});

// Fallback: Redirect all other requests to student page
app.use((req, res) => {
    if (req.path === '/teacher' || req.path === '/teacher.html') {
        return res.sendFile(path.join(__dirname, 'public', 'teacher.html'));
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Automated Attendance Server Started!`);
    console.log(`📡 Local Network Access URL: http://${LOCAL_IP}:${PORT}`);
    console.log(`👨‍🏫 Teacher Dashboard:         http://${LOCAL_IP}:${PORT}/teacher`);
    console.log(`🔑 Admin Password:           ${ADMIN_PASSWORD}`);
    console.log(`======================================================\n`);
});
