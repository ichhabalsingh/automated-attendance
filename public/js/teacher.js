// Teacher Command Center JavaScript

let sseSource = null;
let activeSession = null;
let registeredStudents = [];
let attendanceHistory = [];
let activeTeacherTab = 'live';

document.addEventListener('DOMContentLoaded', () => {
    // Initial data fetch
    fetchServerInfo();
    fetchStudents();
    fetchHistory();
    
    // Connect to Server-Sent Events (SSE) for live stream
    connectSSE();
});

// Fetch Server Status and Local IP Address
async function fetchServerInfo() {
    try {
        const response = await fetch('/api/server-info');
        if (response.status === 401) {
            window.location.href = '/login.html';
            return;
        }
        const data = await response.json();
        
        // Update URL labels
        document.getElementById('classroom-url').innerText = data.url;
        
        if (data.activeSession) {
            setupActiveSessionView(data.activeSession);
        } else {
            setupInactiveSessionView();
        }
    } catch (err) {
        console.error('Failed to get server info:', err);
    }
}

// Fetch all registered students
async function fetchStudents() {
    try {
        const response = await fetch('/api/students');
        if (response.status === 401) {
            window.location.href = '/login.html';
            return;
        }
        const data = await response.json();
        registeredStudents = data;
        document.getElementById('total-students-count').innerText = registeredStudents.length;
        renderDirectory();
    } catch (err) {
        console.error('Failed to fetch students:', err);
    }
}

// Fetch session archives
async function fetchHistory() {
    try {
        const response = await fetch('/api/history');
        if (response.status === 401) {
            window.location.href = '/login.html';
            return;
        }
        const data = await response.json();
        attendanceHistory = data;
        renderHistoryTable();
    } catch (err) {
        console.error('Failed to fetch attendance history:', err);
    }
}

// Connect to Server Sent Events
function connectSSE() {
    const streamStatus = document.getElementById('stream-status');
    
    if (sseSource) {
        sseSource.close();
    }

    sseSource = new EventSource('/api/events');

    sseSource.onopen = () => {
        streamStatus.innerText = 'Live Feed Connected';
        streamStatus.className = 'badge badge-success';
    };

    sseSource.onerror = () => {
        streamStatus.innerText = 'Offline / Reconnecting';
        streamStatus.className = 'badge';
        streamStatus.style.background = 'rgba(244, 63, 94, 0.15)';
        streamStatus.style.color = '#fda4af';
    };

    sseSource.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleSSEMessage(msg.type, msg.data);
    };
}

// Handle SSE message payloads
function handleSSEMessage(type, data) {
    switch (type) {
        case 'session_start':
            setupActiveSessionView(data);
            break;
        case 'session_update':
            if (activeSession) {
                activeSession.pin = data.pin;
                activeSession.qrCode = data.qrCode;
                activeSession.url = data.url;
                document.getElementById('qr-image').src = data.qrCode;
                document.getElementById('classroom-url').innerText = data.url;
            }
            break;
        case 'session_stop':
            setupInactiveSessionView();
            fetchHistory(); // refresh history table
            break;
        case 'checkin':
            addCheckinToFeed(data);
            break;
        case 'checkin_flagged':
            flagCheckinInFeed(data);
            break;
        case 'students_update':
            registeredStudents = data;
            document.getElementById('total-students-count').innerText = registeredStudents.length;
            renderDirectory();
            break;
        case 'reset':
            location.reload();
            break;
    }
}

// Switch tabs inside right panel
function switchTeacherTab(tab) {
    activeTeacherTab = tab;
    
    const btnLive = document.getElementById('btn-tab-live');
    const btnDir = document.getElementById('btn-tab-directory');
    const liveContent = document.getElementById('live-stream-content');
    const dirContent = document.getElementById('student-directory-content');
    const headerTitle = document.getElementById('panel-header-title');

    if (tab === 'live') {
        btnLive.classList.add('active');
        btnDir.classList.remove('active');
        liveContent.style.display = 'block';
        dirContent.style.display = 'none';
        headerTitle.innerText = 'Live Attendance Stream';
    } else {
        btnLive.classList.remove('active');
        btnDir.classList.add('active');
        liveContent.style.display = 'none';
        dirContent.style.display = 'block';
        headerTitle.innerText = 'Student Directory';
        renderDirectory();
    }
}

// Start Session
async function startSession() {
    const startBtn = document.getElementById('start-session-btn');
    startBtn.disabled = true;
    startBtn.innerText = 'Creating Session...';
    
    try {
        const response = await fetch('/api/session/start', { method: 'POST' });
        const result = await response.json();
        
        if (response.ok) {
            setupActiveSessionView(result.session);
            fetchStudents(); // refresh registered count in case of updates
        } else {
            alert(result.error || 'Failed to start session.');
        }
    } catch (err) {
        alert('Error connecting to server. Please try again.');
    } finally {
        startBtn.disabled = false;
        startBtn.innerText = 'Start Check-In Session';
    }
}

// Stop Session
async function stopSession() {
    if (!confirm('Are you sure you want to close this session and save the records?')) {
        return;
    }

    const stopBtn = document.getElementById('stop-session-btn');
    stopBtn.disabled = true;
    
    try {
        const response = await fetch('/api/session/stop', { method: 'POST' });
        if (response.ok) {
            setupInactiveSessionView();
            fetchHistory();
        } else {
            alert('Failed to stop session.');
        }
    } catch (err) {
        alert('Error connecting to server.');
    } finally {
        stopBtn.disabled = false;
    }
}

// Configure UI for active session
function setupActiveSessionView(session) {
    activeSession = session;
    
    // Status Badge
    const statusText = document.getElementById('session-status-text');
    statusText.innerText = 'Active';
    statusText.style.color = 'var(--color-success)';
    
    document.getElementById('session-pulse').className = 'pulse-dot';
    
    // QR Elements
    document.getElementById('qr-placeholder').style.display = 'none';
    const qrContainer = document.getElementById('qr-container');
    qrContainer.style.display = 'block';
    document.getElementById('qr-image').src = session.qrCode;
    
    document.getElementById('link-info').style.display = 'block';
    document.getElementById('classroom-url').innerText = session.url;
    
    // Action Buttons
    document.getElementById('start-session-btn').style.display = 'none';
    document.getElementById('stop-session-btn').style.display = 'block';
    document.getElementById('btn-manual-checkin').disabled = false;

    // Clear feed from previous sessions
    document.getElementById('empty-feed-placeholder').style.display = 'none';
    const checkinList = document.getElementById('checkin-list');
    checkinList.innerHTML = '';
    checkinList.style.display = 'flex';
    
    // Set checked in count
    document.getElementById('checked-in-count').innerText = '0';
    
    // Load pre-existing records (if resuming connection)
    if (session.records && session.records.length > 0) {
        document.getElementById('empty-feed-placeholder').style.display = 'none';
        session.records.forEach(record => {
            addCheckinToFeed(record, false); // load fast without re-animating
        });
    }

    // Refresh directory so manual checkin buttons are active
    renderDirectory();
}

// Configure UI for inactive session
function setupInactiveSessionView() {
    activeSession = null;
    
    // Status Badge
    const statusText = document.getElementById('session-status-text');
    statusText.innerText = 'Inactive';
    statusText.style.color = 'var(--text-secondary)';
    
    document.getElementById('session-pulse').className = 'pulse-dot inactive';
    
    // QR Elements
    document.getElementById('qr-placeholder').style.display = 'flex';
    document.getElementById('qr-container').style.display = 'none';
    document.getElementById('qr-image').src = '';
    document.getElementById('link-info').style.display = 'none';
    
    // Action Buttons
    document.getElementById('start-session-btn').style.display = 'block';
    document.getElementById('stop-session-btn').style.display = 'none';
    document.getElementById('btn-manual-checkin').disabled = true;
    
    // Feed Elements
    document.getElementById('empty-feed-placeholder').style.display = 'flex';
    document.getElementById('checkin-list').style.display = 'none';
    document.getElementById('checked-in-count').innerText = '0';

    // Refresh directory to disable check-in buttons
    renderDirectory();
}

// Add checked in student card to stream
function addCheckinToFeed(record, animate = true) {
    document.getElementById('empty-feed-placeholder').style.display = 'none';
    const checkinList = document.getElementById('checkin-list');
    checkinList.style.display = 'flex';

    // Avoid duplicating entry in DOM if it somehow arrived twice
    if (document.getElementById(`roll-card-${record.rollNumber}`)) {
        return;
    }

    const card = document.createElement('div');
    card.id = `roll-card-${record.rollNumber}`;
    card.className = 'checkin-card' + (record.flagged ? ' flagged' : '');
    if (!animate) {
        card.style.animation = 'none';
    }

    const checkTime = new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    card.innerHTML = `
        <div class="checkin-info">
            <div class="checkin-name">${record.name}</div>
            <div class="checkin-roll">${record.rollNumber}</div>
            ${record.flagged ? `<div class="flag-badge" id="flag-badge-${record.rollNumber}">${record.flagReason}</div>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div class="checkin-meta">
                <div class="checkin-time">${checkTime}</div>
                <div class="checkin-ip">${record.ip}</div>
            </div>
            <button class="btn btn-secondary" onclick="removeCheckinRecord('${record.rollNumber}')" style="padding: 0.35rem 0.5rem; font-size: 0.75rem; border-color: rgba(244, 63, 94, 0.15); color: #fda4af;" title="Remove check-in">
                🗑️
            </button>
        </div>
    `;

    checkinList.insertBefore(card, checkinList.firstChild);

    // Update check-in counts
    const countVal = parseInt(document.getElementById('checked-in-count').innerText);
    document.getElementById('checked-in-count').innerText = (countVal + 1).toString();
    
    // Refresh directory to disable manual checkin for this student
    renderDirectory();
}

// Flag a card retroactively
function flagCheckinInFeed(record) {
    const card = document.getElementById(`roll-card-${record.rollNumber}`);
    if (card) {
        card.classList.add('flagged');
        
        let badge = document.getElementById(`flag-badge-${record.rollNumber}`);
        if (!badge) {
            const infoDiv = card.querySelector('.checkin-info');
            badge = document.createElement('div');
            badge.id = `flag-badge-${record.rollNumber}`;
            badge.className = 'flag-badge';
            infoDiv.appendChild(badge);
        }
        badge.innerText = record.flagReason;
    }
}

// Remove a check-in record from active session
async function removeCheckinRecord(rollNumber) {
    if (!confirm(`Are you sure you want to remove the attendance log for roll number ${rollNumber}?`)) {
        return;
    }

    try {
        const response = await fetch('/api/checkin/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rollNumber })
        });
        
        const result = await response.json();
        if (response.ok) {
            // Remove card from feed
            const card = document.getElementById(`roll-card-${rollNumber}`);
            if (card) {
                card.remove();
                
                // Decrement checked-in count
                const countVal = parseInt(document.getElementById('checked-in-count').innerText);
                document.getElementById('checked-in-count').innerText = Math.max(0, countVal - 1).toString();
            }
            renderDirectory();
        } else {
            alert(result.error || 'Failed to remove check-in.');
        }
    } catch (err) {
        alert('Connection error occurred.');
    }
}

// Render student directory list
function renderDirectory() {
    const dirList = document.getElementById('directory-list');
    if (!dirList) return;
    
    dirList.innerHTML = '';
    
    const searchQuery = document.getElementById('directory-search').value.toLowerCase();
    const filtered = registeredStudents.filter(student => 
        student.name.toLowerCase().includes(searchQuery) || 
        student.rollNumber.toLowerCase().includes(searchQuery)
    );

    if (filtered.length === 0) {
        dirList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No students found.</div>`;
        return;
    }

    // Sort alphabetically by name
    filtered.sort((a, b) => a.name.localeCompare(b.name));

    filtered.forEach(student => {
        const isAlreadyCheckedIn = activeSession && activeSession.records.some(r => r.rollNumber === student.rollNumber);
        
        const card = document.createElement('div');
        card.className = 'directory-card';
        card.innerHTML = `
            <div class="checkin-info">
                <div class="checkin-name">${student.name}</div>
                <div class="checkin-roll">${student.rollNumber}</div>
            </div>
            <div class="action-btns">
                <button class="btn btn-secondary btn-small" onclick='openStudentModal(${JSON.stringify(student)})'>
                    ✏️ Edit
                </button>
                <button class="btn btn-success btn-small" onclick="manualCheckIn('${student.rollNumber}')" 
                    ${(!activeSession || isAlreadyCheckedIn) ? 'disabled' : ''}>
                    ${isAlreadyCheckedIn ? 'Checked In' : '➕ Check In'}
                </button>
            </div>
        `;
        dirList.appendChild(card);
    });
}

function filterDirectory() {
    renderDirectory();
}

// Student Modal (Add / Edit) Operations
function openStudentModal(student = null) {
    const modal = document.getElementById('student-modal');
    const title = document.getElementById('student-modal-title');
    const oldRollInput = document.getElementById('edit-old-roll');
    const rollInput = document.getElementById('modal-roll-number');
    const nameInput = document.getElementById('modal-student-name');
    const submitBtn = document.getElementById('student-modal-submit-btn');

    if (student) {
        title.innerText = 'Edit Student Profile';
        oldRollInput.value = student.rollNumber;
        rollInput.value = student.rollNumber;
        nameInput.value = student.name;
        submitBtn.innerText = 'Save Changes';
    } else {
        title.innerText = 'Register Student';
        oldRollInput.value = '';
        rollInput.value = '';
        nameInput.value = '';
        submitBtn.innerText = 'Add Student';
    }
    
    modal.classList.add('open');
}

function closeStudentModal() {
    document.getElementById('student-modal').classList.remove('open');
}

async function handleStudentFormSubmit(e) {
    e.preventDefault();
    
    const oldRoll = document.getElementById('edit-old-roll').value;
    const newRoll = document.getElementById('modal-roll-number').value.trim();
    const name = document.getElementById('modal-student-name').value.trim();
    
    const endpoint = oldRoll ? '/api/students/update' : '/api/students/add';
    const body = oldRoll ? { oldRollNumber: oldRoll, newRollNumber: newRoll, name } : { rollNumber: newRoll, name };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const result = await response.json();
        
        if (response.ok) {
            closeStudentModal();
            fetchStudents(); // refresh list
        } else {
            alert(result.error || 'Failed to save student.');
        }
    } catch (err) {
        alert('Server connection error.');
    }
}

// Manual Check-In Modal Operations
function openManualCheckinModal() {
    if (!activeSession) return;
    
    const modal = document.getElementById('manual-checkin-modal');
    const select = document.getElementById('manual-checkin-select');
    select.innerHTML = '';

    // Filter to students not already checked in
    const eligibleStudents = registeredStudents.filter(student => 
        !activeSession.records.some(r => r.rollNumber === student.rollNumber)
    );

    if (eligibleStudents.length === 0) {
        alert('All registered students are already checked in.');
        return;
    }

    eligibleStudents.sort((a,b) => a.name.localeCompare(b.name));

    eligibleStudents.forEach(student => {
        const option = document.createElement('option');
        option.value = student.rollNumber;
        option.innerText = `${student.name} (${student.rollNumber})`;
        select.appendChild(option);
    });

    modal.classList.add('open');
}

function closeManualCheckinModal() {
    document.getElementById('manual-checkin-modal').classList.remove('open');
}

async function handleManualCheckinSubmit(e) {
    e.preventDefault();
    const rollNumber = document.getElementById('manual-checkin-select').value;
    await manualCheckIn(rollNumber);
    closeManualCheckinModal();
}

async function manualCheckIn(rollNumber) {
    try {
        const response = await fetch('/api/checkin/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rollNumber })
        });
        const result = await response.json();
        
        if (response.ok) {
            // Live Stream will update automatically via SSE "checkin" trigger
            renderDirectory();
        } else {
            alert(result.error || 'Check-in failed.');
        }
    } catch (err) {
        alert('Error connecting to server.');
    }
}

// Render Archives list
function renderHistoryTable() {
    const tbody = document.getElementById('history-tbody');
    tbody.innerHTML = '';

    if (attendanceHistory.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">No previous session logs found.</td>
            </tr>
        `;
        return;
    }

    // Render in reverse order (most recent first)
    [...attendanceHistory].reverse().forEach(session => {
        const tr = document.createElement('tr');
        const sessionDate = new Date(session.startTime).toLocaleString();
        
        tr.innerHTML = `
            <td><strong>${sessionDate}</strong></td>
            <td style="font-family: monospace; font-size: 0.85rem; color: var(--text-secondary);">${session.sessionId}</td>
            <td><span class="badge badge-success">${session.records.length} Present</span></td>
            <td>
                <button class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="exportSessionToCSV('${session.sessionId}')">
                    📥 Export CSV
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Find session and trigger browser download
function exportSessionToCSV(sessionId) {
    const session = attendanceHistory.find(s => s.sessionId === sessionId);
    if (!session) {
        alert('Session data not found.');
        return;
    }

    let csvContent = "\ufeffRoll Number,Name,Timestamp,IP Address,Flagged,Flag Reason\r\n";
    session.records.forEach(r => {
        const time = new Date(r.timestamp).toLocaleString();
        const cleanName = r.name.replace(/"/g, '""');
        const cleanReason = (r.flagReason || '').replace(/"/g, '""');
        
        csvContent += `"${r.rollNumber}","${cleanName}","${time}","${r.ip}","${r.flagged ? 'YES' : 'NO'}","${cleanReason}"\r\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    
    const dateStr = new Date(session.startTime).toISOString().slice(0, 10);
    link.download = `attendance_session_${dateStr}_${sessionId}.csv`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Master Reset database function
async function confirmResetDatabase() {
    if (!confirm('🚨 WARNING: This will permanently delete all registered students and all saved attendance logs! This action cannot be undone.\n\nAre you sure you want to clear the entire database?')) {
        return;
    }
    
    if (prompt('Type "RESET" (without quotes) to confirm deletion:') !== 'RESET') {
        alert('Reset cancelled. Data preserved.');
        return;
    }

    try {
        const response = await fetch('/api/reset', { method: 'POST' });
        const result = await response.json();
        
        if (response.ok) {
            alert(result.message);
            location.reload();
        } else {
            alert('Failed to clear database.');
        }
    } catch (err) {
        alert('Error connecting to server.');
    }
}
