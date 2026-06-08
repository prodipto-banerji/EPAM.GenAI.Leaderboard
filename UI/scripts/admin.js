// admin.js - Slot Admin Panel client-side logic
(function () {
    const API_BASE = '/api';
    let currentLocation = null;
    let activeSlotId = null;
    let timerInterval = null;
    let slotStartTime = null;

    // DOM Elements
    const loginScreen = document.getElementById('login-screen');
    const adminPanel = document.getElementById('admin-panel');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const locationBadge = document.getElementById('location-badge');
    const logoutBtn = document.getElementById('logout-btn');
    const noActiveSlot = document.getElementById('no-active-slot');
    const activeSlotDiv = document.getElementById('active-slot');
    const activeSlotName = document.getElementById('active-slot-name');
    const timerDisplay = document.getElementById('timer');
    const slotNameInput = document.getElementById('slot-name');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const historyBody = document.getElementById('history-body');

    // --- Auth ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.classList.add('hidden');
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (!res.ok) {
                loginError.textContent = data.message || 'Login failed';
                loginError.classList.remove('hidden');
                return;
            }
            currentLocation = data.location;
            showAdminPanel();
        } catch (err) {
            loginError.textContent = 'Network error. Please try again.';
            loginError.classList.remove('hidden');
        }
    });

    logoutBtn.addEventListener('click', () => {
        currentLocation = null;
        activeSlotId = null;
        stopTimer();
        adminPanel.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        document.getElementById('email').value = '';
        document.getElementById('password').value = '';
    });

    // --- Panel ---
    function showAdminPanel() {
        loginScreen.classList.add('hidden');
        adminPanel.classList.remove('hidden');
        locationBadge.textContent = currentLocation;
        loadSlots();
    }

    // --- Slots ---
    async function loadSlots() {
        try {
            const res = await fetch(`${API_BASE}/slots/location/${encodeURIComponent(currentLocation)}`);
            const slots = await res.json();
            renderHistory(slots);

            // Check if there's an active slot for this location
            const active = slots.find(s => s.status === 'active');
            if (active) {
                showActiveSlot(active);
            } else {
                showIdleState();
            }
        } catch (err) {
            console.error('Error loading slots:', err);
        }
    }

    function renderHistory(slots) {
        if (!slots || slots.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="5" class="empty-msg">No slots yet</td></tr>';
            return;
        }

        historyBody.innerHTML = slots.map((slot, i) => `
            <tr class="${slot.status === 'active' ? 'active-row' : ''}">
                <td>${i + 1}</td>
                <td>${escapeHtml(slot.name)}</td>
                <td><span class="status-${slot.status}">${slot.status}</span></td>
                <td>${slot.start_time || '-'}</td>
                <td>${slot.duration || '-'}</td>
            </tr>
        `).join('');
    }

    function showActiveSlot(slot) {
        activeSlotId = slot.id;
        activeSlotName.textContent = slot.name;
        noActiveSlot.classList.add('hidden');
        activeSlotDiv.classList.remove('hidden');
        // Start timer from slot's start_time
        slotStartTime = new Date(slot.start_time + 'Z'); // UTC
        startTimer();
    }

    function showIdleState() {
        activeSlotId = null;
        noActiveSlot.classList.remove('hidden');
        activeSlotDiv.classList.add('hidden');
        stopTimer();
        timerDisplay.textContent = '00:00:00';
    }

    // --- Start/Stop ---
    startBtn.addEventListener('click', async () => {
        const name = slotNameInput.value.trim();
        if (!name) {
            slotNameInput.focus();
            return;
        }
        startBtn.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/slots/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slotName: name, location: currentLocation })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.message || 'Failed to start slot');
                return;
            }
            slotNameInput.value = '';
            showActiveSlot(data.data);
            loadSlots();
        } catch (err) {
            alert('Network error');
        } finally {
            startBtn.disabled = false;
        }
    });

    stopBtn.addEventListener('click', async () => {
        if (!activeSlotId) return;
        stopBtn.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/slots/${activeSlotId}/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.message || 'Failed to stop slot');
                return;
            }
            showIdleState();
            loadSlots();
        } catch (err) {
            alert('Network error');
        } finally {
            stopBtn.disabled = false;
        }
    });

    // --- Timer ---
    function startTimer() {
        stopTimer();
        updateTimerDisplay();
        timerInterval = setInterval(updateTimerDisplay, 1000);
    }

    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    function updateTimerDisplay() {
        if (!slotStartTime) return;
        const now = new Date();
        const diff = Math.floor((now - slotStartTime) / 1000);
        const h = String(Math.floor(diff / 3600)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
        const s = String(diff % 60).padStart(2, '0');
        timerDisplay.textContent = `${h}:${m}:${s}`;
    }

    // --- Utility ---
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
})();
