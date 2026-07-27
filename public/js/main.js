// Student Attendance Portal Logic

// Global states
let sessionParams = {
    id: null,
    pin: null
};

// SVG icons
const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor" style="width: 36px; height: 36px;"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>`;
const crossSVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor" style="width: 36px; height: 36px;"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>`;

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    // Parse URL params
    const urlParams = new URLSearchParams(window.location.search);
    sessionParams.id = urlParams.get('session');
    sessionParams.pin = urlParams.get('pin');

    // Setup event listeners

    // Check if student identity is already saved
    const savedStudent = getSavedIdentity();
    if (savedStudent) {
        showRememberedBadge(savedStudent);
        
        // If there's an active session in the URL, try to auto-checkin!
        if (sessionParams.id && sessionParams.pin) {
            autoCheckIn(savedStudent.rollNumber);
            return;
        }
    }

    // Default: show form
    resetPortalView();
});

// Local Storage helpers
function getSavedIdentity() {
    const data = localStorage.getItem('attendance_student_identity');
    return data ? JSON.parse(data) : null;
}

function saveIdentity(rollNumber, name) {
    localStorage.setItem('attendance_student_identity', JSON.stringify({ rollNumber, name }));
}

function clearSavedIdentity() {
    localStorage.removeItem('attendance_student_identity');
    document.getElementById('remembered-badge').style.display = 'none';
    document.getElementById('attendance-form').style.display = 'block';
    
    // Show form inputs and make them editable
    document.getElementById('roll-number').value = '';
    document.getElementById('student-name').value = '';
    
    document.getElementById('portal-title').innerText = 'Student Registration';
    document.getElementById('portal-subtitle').innerText = 'Register your details once to join the attendance session';
}

function showRememberedBadge(student) {
    document.getElementById('remembered-name').innerText = student.name;
    document.getElementById('remembered-roll').innerText = student.rollNumber;
    document.getElementById('remembered-badge').style.display = 'block';
    document.getElementById('attendance-form').style.display = 'none';
    
    document.getElementById('portal-title').innerText = 'Welcome Back';
    document.getElementById('portal-subtitle').innerText = 'Scan the QR code to log your attendance automatically';
}

// Perform automated check-in
async function autoCheckIn(rollNumber) {
    showPanel('loader-panel');
    
    try {
        const response = await fetch('/api/checkin', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                rollNumber: rollNumber,
                sessionId: sessionParams.id,
                pin: sessionParams.pin
            })
        });

        const result = await response.json();

        if (response.ok) {
            showStatus(true, result.already ? 'Already Checked In' : 'Attendance Marked!', `Successfully verified on server. Welcome to class!`, result.student);
        } else {
            // If server reports student is actually not registered, clear local state and force registration
            if (result.error === 'NOT_REGISTERED') {
                clearSavedIdentity();
                showStatus(false, 'Registration Needed', 'Your details were not found on the server. Please register again below.');
            } else {
                showStatus(false, 'Check-in Failed', result.error || 'Server rejected check-in. Please try scanning again.');
            }
        }
    } catch (err) {
        showStatus(false, 'Network Error', 'Could not reach the attendance server. Are you connected to the classroom Wi-Fi?');
    }
}

// Manual Form Submission
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const rollNumber = document.getElementById('roll-number').value.trim();
    const name = document.getElementById('student-name').value.trim();
    
    if (!sessionParams.id || !sessionParams.pin) {
        showStatus(false, 'No Active Session', 'Please scan the QR code displayed on the teacher\'s screen to start.');
        return;
    }

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.innerText = 'Submitting...';

    try {
        const response = await fetch('/api/checkin', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                rollNumber,
                name: name,
                sessionId: sessionParams.id,
                pin: sessionParams.pin
            })
        });

        const result = await response.json();

        if (response.ok) {
            // Save identity to local storage so they don't have to fill it out next time
            saveIdentity(result.student.rollNumber, result.student.name);
            showRememberedBadge(result.student);
            showStatus(true, 'Attendance Marked!', 'Your attendance has been registered successfully.', result.student);
        } else {
            showStatus(false, 'Check-in Failed', result.error || 'Validation error occurred.');
        }
    } catch (err) {
        showStatus(false, 'Connection Error', 'Could not connect to the classroom server. Please check your router connection.');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Submit Check-In';
    }
}

// Show specific panel
function showPanel(panelId) {
    document.getElementById('form-panel').style.display = panelId === 'form-panel' ? 'block' : 'none';
    document.getElementById('loader-panel').style.display = panelId === 'loader-panel' ? 'block' : 'none';
    document.getElementById('status-panel').style.display = panelId === 'status-panel' ? 'flex' : 'none';
}

// Reset view back to form
function resetPortalView() {
    const saved = getSavedIdentity();
    if (saved) {
        showRememberedBadge(saved);
    } else {
        document.getElementById('remembered-badge').style.display = 'none';
        document.getElementById('attendance-form').style.display = 'block';
    }
    showPanel('form-panel');
}

// Display Success / Error page
function showStatus(isSuccess, title, message, studentDetails = null) {
    const iconBox = document.getElementById('status-icon-box');
    const titleText = document.getElementById('status-title-text');
    const descText = document.getElementById('status-desc');
    const badge = document.getElementById('result-badge');

    titleText.innerText = title;
    descText.innerText = message;
    
    iconBox.className = 'status-icon ' + (isSuccess ? 'success' : 'error');
    iconBox.innerHTML = isSuccess ? checkSVG : crossSVG;

    if (isSuccess && studentDetails) {
        badge.innerHTML = `🎓 <strong>${studentDetails.name}</strong> (${studentDetails.rollNumber})`;
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }

    showPanel('status-panel');
}
