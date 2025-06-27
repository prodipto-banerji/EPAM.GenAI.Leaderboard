// WebSocket connection
let ws;
let currentLocation = null;

// Store previous top 3 players
let previousTop3 = [];

// Store previous top 10 players for comparison
let previousTop10 = [];

// Infinite scroll state
let allPlayers = [];
let displayedPlayers = 0;
const playersPerLoad = 7; // Number of players to load each time
const initialTableSize = 7; // Number of players to show in table initially
let isLoading = false; // Flag to prevent multiple simultaneous loads

// Slot management
let currentSlotId = null;
let slots = [];

// Debounce flag to prevent multiple rapid WebSocket requests
let lastRequestTime = 0;
const REQUEST_DEBOUNCE_MS = 1000; // 1 second debounce

// Cache last processed data to prevent duplicate processing
let lastProcessedDataHash = null;

function selectLocation(location) {
    // Clear current data first
    clearDashboard();
    
    // Update location in localStorage
    localStorage.setItem('selectedLocation', location);
    
    // Set current location
    currentLocation = location;
    
    // Close existing WebSocket connection if any
    if (ws) {
        ws.close();
    }
    
    // Load initial data and establish new WebSocket connection
    loadInitialData(location);
    
    // Update location display
    document.getElementById('currentLocation').textContent = location;
    document.getElementById('locationSelector').classList.add('hidden');
}

function showLocationSelector() {
    document.getElementById('locationSelector').classList.remove('hidden');
}

// Clear dashboard data
function clearDashboard() {
    console.log('Clearing dashboard');
    const podiumContainer = document.getElementById('podiumContainer');
    const tbody = document.querySelector('.leaderboard-table tbody');
    
    // Clear containers
    if (podiumContainer) {
        podiumContainer.innerHTML = '';
    }
    if (tbody) {
        tbody.innerHTML = '';
    }
    
    // Reset all player arrays
    allPlayers = [];
    displayedPlayers = 0;
    previousTop3 = [];
    
    // Hide leaderboard components when clearing
    hideLeaderboardComponents();
    
    // Update table display
    updateTableDisplay();
}

// WebSocket connection management
function connectWebSocket(location) {
    return new Promise((resolve, reject) => {
        // Close existing connection if any
        if (ws) {
            ws.close();
        }

        // Get the current host and determine WebSocket protocol
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let wsUrl;
        
        // Check if we're running locally or on Azure
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            // Local development
            wsUrl = `${protocol}//${window.location.host}`;
        } else {
            // Production - use current host
            wsUrl = `${protocol}//${window.location.host}`;
        }
        
        console.log('Connecting to WebSocket at:', wsUrl);
        
        // Connect to WebSocket server
        ws = new WebSocket(wsUrl);
        
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 5;

        ws.onopen = () => {
            console.log('WebSocket connection established');
            // Send location and request initial game status
            ws.send(JSON.stringify({ type: 'setLocation', location }));
            ws.send(JSON.stringify({ type: 'getGameStatus' }));
            resolve(ws);
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'rankings':
                    if (data.location === currentLocation) {
                        // Generate a simple hash to check if data has changed
                        const dataHash = JSON.stringify(data.players.slice(0, 10));
                        if (dataHash !== lastProcessedDataHash) {
                            lastProcessedDataHash = dataHash;
                            console.log('Updating dashboard with new rankings:', data.players);
                            // If data.updatedPlayer exists, pass it; else, pass null
                            updateDashboard(data.players, data.location, data.updatedPlayer || null);
                        } else {
                            console.log('Skipping duplicate data processing');
                        }
                    }
                    break;

                case 'gameStatus':
                    console.log('Received game status update:', data.status);
                    const previousActiveSlotId = currentSlotId;
                    updateGameStatus(data.status);

                    if (data.status.slots) {
                        updateSlotTabs(data.status.slots, data.status.activeSlotId);
                        
                        // Check if we need to show "Game is Running!" message for active slot with no players
                        if (data.status.active && data.status.activeSlotId) {
                            currentSlotId = data.status.activeSlotId;
                            
                            // Always show "Game is Running!" message for active games with no players
                            // This ensures we don't show empty podium boxes while waiting for data
                            if (allPlayers.length === 0 && allPlayersFull.length === 0) {
                                console.log('Active game detected with no players, showing game running message');
                                showGameRunningMessage();
                            }
                            
                            // Request fresh rankings with debouncing
                            const now = Date.now();
                            if (now - lastRequestTime > REQUEST_DEBOUNCE_MS) {
                                lastRequestTime = now;
                                ws.send(JSON.stringify({ 
                                    type: 'getRankings', 
                                    location: currentLocation,
                                    slotId: currentSlotId 
                                }));
                            }
                        }
                        // Handle non-active slots
                        else if (data.status.activeSlotId) {
                            currentSlotId = data.status.activeSlotId;
                            
                            // Still request fresh data to ensure we're up to date
                            const now = Date.now();
                            if (now - lastRequestTime > REQUEST_DEBOUNCE_MS) {
                                lastRequestTime = now;
                                ws.send(JSON.stringify({ 
                                    type: 'getRankings', 
                                    location: currentLocation,
                                    slotId: currentSlotId 
                                }));
                            }
                        } 
                    }
                    break;

                case 'playerUpdate':
                    console.log('Received player update for location:', data.location);
                    if (data.location === currentLocation) {
                        // Immediately request fresh rankings
                        ws.send(JSON.stringify({ 
                            type: 'getRankings', 
                            location: currentLocation,
                            slotId: currentSlotId,
                            updatedPlayer: data.player || null // Pass player if available
                        }));
                    }
                    break;
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            reject(error);
        };

        ws.onclose = () => {
            console.log('WebSocket connection closed');
            // Attempt to reconnect after 5 seconds
            setTimeout(() => {
                if (reconnectAttempts < maxReconnectAttempts) {
                    console.log(`Attempting to reconnect... (${reconnectAttempts + 1}/${maxReconnectAttempts})`);
                    reconnectAttempts++;
                    connectWebSocket(location)
                        .catch(error => console.error('Reconnection failed:', error));
                }
            }, 5000);
        };
    });
}

// Color palette for avatars
const colorPalette = [
    { bg: '#FF6B6B', text: '#ffffff' }, // Coral Red
    { bg: '#FFB347', text: '#ffffff' }, // Pastel Orange
    { bg: '#9B5DE5', text: '#ffffff' }, // Purple
    { bg: '#FF69B4', text: '#ffffff' }, // Hot Pink
    { bg: '#45B7D1', text: '#ffffff' }, // Sky Blue
    { bg: '#FFD700', text: '#000000' }, // Gold
    { bg: '#FF7F50', text: '#ffffff' }, // Coral
    { bg: '#DA70D6', text: '#ffffff' }  // Orchid
];

function getDefaultAvatar(name) {
    // Generate a deterministic index based on name
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorIndex = Math.abs(hash) % colorPalette.length;
    const colors = colorPalette[colorIndex];
    
    // Create canvas for avatar
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    
    // Draw colored circle
    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.arc(50, 50, 50, 0, Math.PI * 2);
    ctx.fill();
    
    // Add initials
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase();
    ctx.fillStyle = colors.text;
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, 50, 50);
    
    return canvas.toDataURL();
}

// Create confetti
function createConfetti(x, y, count = 1) {
    const colors = ['#ffd700', '#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#00ffff'];
    const shapes = ['circle', 'square', 'triangle'];
    
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            
            // Randomize starting position for more natural effect
            const startX = x + (Math.random() - 0.5) * 200;
            const startY = y - 20; // Start slightly above the trigger point
            
            // Random shape
            const shape = shapes[Math.floor(Math.random() * shapes.length)];
            if (shape === 'circle') {
                confetti.style.borderRadius = '50%';
            } else if (shape === 'triangle') {
                confetti.style.clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)';
            }
            
            // Random color and size
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.width = `${8 + Math.random() * 6}px`;
            confetti.style.height = `${8 + Math.random() * 6}px`;
            
            // Position and initial transform
            confetti.style.left = `${startX}px`;
            confetti.style.top = `${startY}px`;
            
            // Add some sparkle
            confetti.style.boxShadow = '0 0 3px #fff';
            
            document.body.appendChild(confetti);
            
            // Add random horizontal movement
            const duration = 2000 + Math.random() * 1000;
            confetti.style.animation = `confetti-fall ${duration}ms ease-out forwards`;
            
            // Remove confetti after animation
            setTimeout(() => confetti.remove(), duration);
        }, i * (1000 / count)); // Spread out the creation of confetti
    }
}

// Show celebration text with improved animation
function showCelebrationText(x, y, text) {
    const celebration = document.createElement('div');
    celebration.className = 'celebration-text';
    celebration.textContent = text;
    celebration.style.left = '50%';
    celebration.style.top = `${Math.max(20, y - 100)}px`;
    celebration.style.transform = 'translateX(-50%)';
    celebration.innerHTML = `✨ ${text} ✨`;
    document.body.appendChild(celebration);
    // Remove celebration text after longer animation (now 6000ms)
    setTimeout(() => celebration.remove(), 6000);
}

// Enhanced celebration for position change
function celebratePositionChange(playerName, oldPos, newPos, element, x, y) {
    // Add shine effect with delay for better visibility
    setTimeout(() => {
        element.classList.add('shine');
        setTimeout(() => element.classList.remove('shine'), 1000);
    }, 100);

    // Add position change animation
    element.classList.add('position-change');
    setTimeout(() => element.classList.remove('position-change'), 1000);

    // Create confetti with different amounts based on position
    let confettiCount = 20;
    if (newPos === 0) {
        confettiCount = 50; // More confetti for first place
    } else if (oldPos > 2 && newPos <= 2) {
        confettiCount = 30; // Medium amount for entering top 3
    }
    
    // Create confetti in two bursts for better effect
    createConfetti(x, y, confettiCount / 2);
    setTimeout(() => createConfetti(x, y, confettiCount / 2), 200);

    // Show celebration text with appropriate message
    let celebrationText = '';
    if (newPos === 0) {
        celebrationText = `👑 ${playerName} Claims the Crown! 👑`;
    } else if (oldPos > 2 && newPos <= 2) {
        celebrationText = `🌟 ${playerName} Joins the Elite! 🌟`;
    } else if (newPos < oldPos) {
        celebrationText = `⬆️ ${playerName} is Rising! ⬆️`;
    }

    if (celebrationText) {
        showCelebrationText(x, y - 50, celebrationText);
    }
}

// Compare rankings and trigger celebrations
function checkForPositionChanges(newPlayers) {
    const top3 = newPlayers.slice(0, 3);
    
    // Only proceed if we have previous data to compare with
    if (previousTop3.length === 0) {
        previousTop3 = [...top3];
        return;
    }

    // Check if there's any real change in top 3
    const hasChanges = top3.some((player, index) => {
        const prevPlayer = previousTop3[index];
        return !prevPlayer || prevPlayer.name !== player.name || prevPlayer.score !== player.score;
    });

    if (hasChanges) {
        top3.forEach((player, index) => {
            const prevPlayer = previousTop3[index];
            const isNewToPosition = !prevPlayer || prevPlayer.name !== player.name;
            const hasImprovedScore = prevPlayer && prevPlayer.name === player.name && player.score > prevPlayer.score;
            
            if (isNewToPosition || hasImprovedScore) {
                const element = document.querySelector(`.podium-place:nth-child(${index + 1})`);
                if (element) {
                    celebratePositionChange(
                        player.name,
                        isNewToPosition ? 999 : index,
                        index,
                        element,
                        element.getBoundingClientRect().left + element.offsetWidth / 2,
                        element.getBoundingClientRect().top
                    );
                }
            }
        });
    }

    // Update previous top 3 with full player objects
    previousTop3 = [...top3];
}

// Throttle function to limit scroll event handling
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// Infinite scroll handler
function handleScroll() {
    if (isLoading) return;

    const tableContainer = document.querySelector('.leaderboard-table');
    if (!tableContainer) return;

    const loadingIndicator = document.getElementById('loadingIndicator');
    const scrollPosition = window.innerHeight + window.pageYOffset;
    const tableBottom = tableContainer.offsetTop + tableContainer.offsetHeight;

    // Start loading more when user is within 500px of the bottom for smoother experience
    if (scrollPosition > tableBottom - 500 && displayedPlayers < allPlayers.length) {
        isLoading = true;
        if (loadingIndicator) loadingIndicator.style.display = 'block';
        
        requestAnimationFrame(() => {
            loadMorePlayers();
            isLoading = false;
            if (loadingIndicator) {
                loadingIndicator.style.display = displayedPlayers < allPlayers.length ? 'block' : 'none';
            }
        });
    }
}

// Constants for player loading
const INITIAL_TABLE_SIZE = 7;  // Players 4-10 (after podium)
const SCROLL_BATCH_SIZE = 10;  // Load 10 players at a time when scrolling

// Store all players for load more
let allPlayersFull = [];

// Add a load more button below the table with improved style
function showLoadMoreButton(show) {
    let btn = document.getElementById('loadMoreBtn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'loadMoreBtn';
        btn.textContent = 'Load More';
        btn.style.display = 'none';
        btn.className = 'load-more-btn stylish-load-more';
        btn.onclick = () => {
            loadMorePlayers(true);
        };
        const table = document.querySelector('.leaderboard-table');
        if (table && table.parentNode) {
            table.parentNode.appendChild(btn);
        }
    }
    btn.style.display = show ? 'block' : 'none';
}

// Add CSS for stylish load more button
(function addLoadMoreBtnStyles() {
    if (document.getElementById('loadMoreBtnStyles')) return;
    const style = document.createElement('style');
    style.id = 'loadMoreBtnStyles';
    style.textContent = `
        .stylish-load-more {
            margin: 32px auto 24px auto;
            display: block;
            padding: 14px 36px;
            font-size: 1.15rem;
            font-weight: 600;
            color: #fff;
            background: linear-gradient(90deg, #6a11cb 0%, #2575fc 100%);
            border: none;
            border-radius: 32px;
            box-shadow: 0 4px 16px rgba(80, 120, 255, 0.15);
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
            letter-spacing: 1px;
        }
        .stylish-load-more:hover, .stylish-load-more:focus {
            background: linear-gradient(90deg, #2575fc 0%, #6a11cb 100%);
            transform: translateY(-2px) scale(1.04);
            box-shadow: 0 8px 24px rgba(80, 120, 255, 0.22);
        }
    `;
    document.head.appendChild(style);
})();

// Load more players (7 at a time)
function loadMorePlayers(isLoadMoreClick = false) {
    const tbody = document.querySelector('.leaderboard-table tbody');
    if (!tbody) return;
    let batchSize = 7;
    // If this is a load more click, use allPlayersFull after the first 10
    let sourcePlayers = allPlayers;
    let start = displayedPlayers;
    let end = Math.min(start + batchSize, allPlayers.length);
    let rankOffset = 4;
    // If loading more after top 10
    if (isLoadMoreClick) {
        sourcePlayers = allPlayersFull.slice(10 + displayedPlayers - allPlayers.length);
        start = 0;
        end = Math.min(batchSize, sourcePlayers.length);
        rankOffset = displayedPlayers + 4;
    }
    for (let i = start; i < end; i++) {
        const player = sourcePlayers[i];
        if (!player) continue;
        const row = tbody.insertRow();
        const playerRank = rankOffset + i;
        row.innerHTML = `
            <td>${playerRank}</td>
            <td>
                <div class="player-row">
                    <img class="player-avatar" src="${getDefaultAvatar(player.name)}" alt="${player.name}">
                    ${player.name}
                </div>
            </td>
            <td>${player.score}</td>
            <td>${player.displaytime}</td>
        `;
        row.style.opacity = '0';
        row.style.animation = 'fadeIn 0.5s forwards';
    }
    displayedPlayers += (end - start);
    // If there are more players to load, show button, else hide
    const moreToLoad = allPlayersFull.length > (10 + displayedPlayers - allPlayers.length);
    showLoadMoreButton(moreToLoad);
}

// Toggle visibility of table
function toggleTableVisibility(show) {
    const table = document.querySelector('.leaderboard-table');
    const loadingIndicator = document.getElementById('loadingIndicator');
    
    if (show) {
        table.style.display = 'table';
        if (displayedPlayers < allPlayers.length) {
            loadingIndicator.style.display = 'block';
        }
    } else {
        table.style.display = 'none';
        loadingIndicator.style.display = 'none';
    }
}

// Show no data message
function showNoDataMessage(tbody) {
    const row = tbody.insertRow();
    row.innerHTML = `
        <td colspan="4" style="text-align: center; padding: 20px;">
            No players available at this time
        </td>
    `;
}

// Update table display
function updateTableDisplay() {
    const tbody = document.querySelector('.leaderboard-table tbody');
    if (!tbody) {
        console.error('Table body not found');
        return;
    }

    console.log('Updating table display. Total players:', allPlayers.length);
    tbody.innerHTML = '';
    displayedPlayers = 0;

    // If no players after top 3, check if leaderboard should be visible
    if (allPlayers.length === 0) {
        console.log('No players to display in table');
        // Only show the "no data" message if leaderboard components are supposed to be visible
        const leaderboardTable = document.querySelector('.leaderboard-table');
        if (leaderboardTable && leaderboardTable.style.display !== 'none') {
            showNoDataMessage(tbody);
            toggleTableVisibility(true);
        } else {
            // Leaderboard is hidden, so don't show anything
            toggleTableVisibility(false);
        }
        return;
    }

    toggleTableVisibility(true);
    loadMorePlayers();
}

// Dashboard update functions
async function refreshDashboard(location) {
    try {
        // Show loading state
        document.getElementById('currentLocation').textContent = 'Loading...';
        
        // Connect to WebSocket first
        await connectWebSocket(location);

        // Fetch initial rankings
        const response = await fetch(`${window.location.origin}/api/rankings/${location}`);
        const data = await response.json();
        
        if (data.status === 'success' && location === currentLocation) {
            // Update the UI only if this is still the current location
            updateDashboard(data.rankings, location);
        }
    } catch (error) {
        console.error('Error fetching rankings:', error);
        document.getElementById('currentLocation').textContent = 'Error loading data';
    }
}

function updatePodium(topPlayers, location) {
    if (location !== currentLocation) {
        return;
    }

    // Update location display
    document.getElementById('currentLocation').textContent = location;
    document.getElementById('locationSelector').classList.add('hidden');

    // Update podium (top 3)
    const podiumContainer = document.getElementById('podiumContainer');
    podiumContainer.innerHTML = '';
    
    // Create podium places (top 3)
    const podiumPlaces = [1, 0, 2]; // Order for display: 2nd, 1st, 3rd
    const podiumClasses = ['second-place', 'first-place', 'third-place'];
    
    podiumPlaces.forEach((index, displayIndex) => {
        const player = topPlayers[index];
        if (player) {
            const podiumPlace = document.createElement('div');
            podiumPlace.className = `podium-place ${podiumClasses[displayIndex]}`;
            const medals = ['🥈', '🥇', '🥉'];
            const medalColors = ['#C0C0C0', '#ffd700', '#CD7F32'];
            
            podiumPlace.innerHTML = `
                <div class="medal" style="background-color: ${medalColors[displayIndex]}">
                    ${medals[displayIndex]}
                </div>
                <div class="podium-avatar">
                    <img src="${getDefaultAvatar(player.name)}" alt="${player.name}">
                </div>
                <div class="podium-block">
                    <div class="podium-info">
                        <div class="podium-name">${player.name}</div>
                        <div class="podium-score">${player.score} pts</div>
                        <div class="podium-time">⏱️ ${player.displaytime}</div>
                    </div>
                </div>
            `;
            podiumContainer.appendChild(podiumPlace);
        }
    });
}    // Update slot tabs
    function updateSlotTabs(slotsData, activeSlotId) {
        const slotTabs = document.getElementById('slotTabs');
        slots = slotsData;
        // If no active slot, pick the latest slot (first in sorted list)
        let latestSlotId = null;
        if (!activeSlotId && slots.length > 0) {
            // Assume slots are sorted by start_time DESC from backend
            latestSlotId = slots[0].id;
        }
        // Set currentSlotId to active or latest
        if (activeSlotId) {
            currentSlotId = activeSlotId;
        } else if (latestSlotId) {
            currentSlotId = latestSlotId;
        }
        slotTabs.innerHTML = '';
        slots.forEach(slot => {
            let tabClass = 'slot-tab';
            if (slot.id === currentSlotId) tabClass += ' active';
            if (slot.status === 'active') tabClass += ' active-slot';
            if (slot.status === 'completed') tabClass += ' inactive-slot';
            const tab = document.createElement('button');
            tab.className = tabClass;
            let statusDot = slot.status === 'active' ? 
                '<span class="status-dot"></span>' : 
                '<span class="status-dot"></span>';
            
            // Show slot name and start time in IST on the same line
            const startDate = new Date(slot.start_time);
            // Convert to IST (UTC+5:30)
            const istDate = new Date(startDate.getTime() + (5.5 * 60 * 60 * 1000));
            const startTimeString = istDate.toLocaleTimeString('en-IN', { 
                hour: '2-digit', 
                minute: '2-digit',
                timeZone: 'Asia/Kolkata'
            });
            
            tab.innerHTML = `
                <div class="slot-name-time">
                    ${statusDot} ${slot.name} - ${startTimeString}
                </div>
            `;
            tab.onclick = () => {
                currentSlotId = slot.id;
                loadSlotData(slot.id);
                updateSlotTabs(slots, currentSlotId);
            };
            slotTabs.appendChild(tab);
        });
        // If no active slot, load latest slot data and highlight its tab
        if (!activeSlotId && latestSlotId) {
            loadSlotData(latestSlotId);
        }
    }

// Load data for a specific slot
async function loadSlotData(slotId) {
    try {
        console.log('Loading data for slot:', slotId);
        currentSlotId = slotId;

        // Check if this is an active slot by looking at our slots data
        const activeSlot = slots.find(slot => slot.id === slotId && slot.status === 'active');
        
        if (activeSlot) {
            // If we're loading an active slot and have no player data, show game running message
            // This prevents showing empty podium while data loads
            if (allPlayers.length === 0 && allPlayersFull.length === 0) {
                console.log('Loading active slot with no players, showing game running message');
                showGameRunningMessage();
            }
        } else {
            // For inactive slots, clear any game running message and show components
            hideGameRunningMessage();
            showLeaderboardComponents();
            
            // Update UI to show loading state for inactive slots
            const tbody = document.querySelector('.leaderboard-table tbody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" class="loading-message">Loading data...</td></tr>';
            }
        }

        // Request fresh rankings through WebSocket
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('Requesting rankings for slot:', slotId);
            ws.send(JSON.stringify({ 
                type: 'getRankings', 
                location: currentLocation,
                slotId: slotId 
            }));
        } else {
            console.log('WebSocket not ready, fetching data via HTTP');
            // Fallback to HTTP if WebSocket is not available
            const response = await fetch(`${window.location.origin}/api/rankings/${currentLocation}?slotId=${slotId}`);
            const data = await response.json();
            
            if (data.status === 'success') {
                updateDashboard(data.rankings, currentLocation);
            }
        }
    } catch (error) {
        console.error('Error loading slot data:', error);
        const tbody = document.querySelector('.leaderboard-table tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="4" class="error-message">Error loading data. Please try again.</td></tr>';
        }
    }
}

// Load initial data for a location
async function loadInitialData(location) {
    try {
        console.log('Loading initial data for location:', location);
        
        // Show loading state
        document.getElementById('currentLocation').textContent = 'Loading...';
        
        // Connect to WebSocket first
        await connectWebSocket(location);
        
        // Fetch initial rankings
        console.log('Fetching initial rankings');
        const response = await fetch(`${window.location.origin}/api/rankings/${location}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        if (data.status === 'success' && location === currentLocation) {
            console.log('Initial rankings received:', data.rankings);
            if (Array.isArray(data.rankings) && data.rankings.length > 0) {
                updateDashboard(data.rankings, location);
            } else {
                // No rankings data - let the game status logic handle the display
                console.log('No rankings data available');
                hideLeaderboardComponents();
            }
        } else {
            console.log('Initial rankings not successful or location changed');
            // Let the game status logic handle the display
            hideLeaderboardComponents();
        }

        // Update location display
        document.getElementById('currentLocation').textContent = location;
    } catch (error) {
        console.error('Error loading initial data:', error);
        document.getElementById('currentLocation').textContent = location;
        // Let the game status logic handle the display
        hideLeaderboardComponents();
    }
}

// Show game running message when no players have played yet
function showGameRunningMessage() {
    // First hide any existing game status messages and the game running message
    hideGameRunningMessage();
    const gameStatusDiv = document.getElementById('gameStatus');
    if (gameStatusDiv) {
        gameStatusDiv.style.display = 'none';
    }
    
    // Hide leaderboard components when showing game running message
    hideLeaderboardComponents();
    
    const podiumContainer = document.getElementById('podiumContainer');
    const tbody = document.querySelector('.leaderboard-table tbody');
    
    // Clear existing content
    if (podiumContainer) {
        podiumContainer.innerHTML = '';
    }
    if (tbody) {
        tbody.innerHTML = '';
    }
    
    // Create and show the game running message
    const gameRunningDiv = document.createElement('div');
    gameRunningDiv.id = 'gameRunningMessage';
    gameRunningDiv.className = 'game-running-message';
    gameRunningDiv.innerHTML = `
        <div class="game-running-content">
            <div class="game-running-icon">🎮</div>
            <h2>Game is Running!</h2>
            <p>Waiting for players to join the adventure...</p>
            <div class="play-prompt">
                <span class="play-text">Ready to play?</span>
                <div class="scan-qr">👉 Scan the QR code on the right!</div>
            </div>
        </div>
    `;
    
    // Insert in the main content area
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.insertBefore(gameRunningDiv, mainContent.firstChild);
    }
}

// Hide game running message
function hideGameRunningMessage() {
    const existingMessage = document.getElementById('gameRunningMessage');
    if (existingMessage) {
        existingMessage.remove();
    }
}

// Helper: check if a player is in the top 10
function isPlayerInTop10(player, players) {
    if (!player || !Array.isArray(players)) return false;
    return players.slice(0, 10).some(p => p && p.name === player.name);
}

// Update dashboard to only show top 10 (3 podium, 7 table), rest on load more
async function updateDashboard(players, location, updatedPlayer = null) {
    console.log('Updating dashboard with players:', players.length);
    
    if (location !== currentLocation) {
        console.log('Location mismatch, skipping update');
        return;
    }
    if (!Array.isArray(players)) {
        console.error('Invalid players data received');
        showNoDataMessage(document.querySelector('.leaderboard-table tbody'));
        return;
    }
    
    // If updatedPlayer is provided, only update if that player is in the new top 10
    if (updatedPlayer && !isPlayerInTop10(updatedPlayer, players)) {
        console.log('Updated player not in top 10, skipping dashboard update');
        return;
    }
    
    // Store all players for load more
    allPlayersFull = players;
    
    // Check if no players have played yet
    if (players.length === 0) {
        showGameRunningMessage();
        return;
    }
    
    // Hide the game running message if it exists
    hideGameRunningMessage();
    
    // Show leaderboard components since we have player data
    showLeaderboardComponents();
    
    // Only show top 10 initially
    const top10 = players.slice(0, 10);
    const top3Players = top10.slice(0, 3);
    
    console.log('Top 3 players:', top3Players);
    updatePodium(top3Players, location);
    
    console.log('Remaining players for table:', top10.length - 3);
    allPlayers = top10.slice(3); // 4-10 for table
    displayedPlayers = 0;
    
    const tbody = document.querySelector('.leaderboard-table tbody');
    if (tbody) {
        tbody.innerHTML = '';
        loadMorePlayers();
    }
    
    // Show/hide load more button
    showLoadMoreButton(players.length > 10);
    
    // Check for position changes
    checkForPositionChanges(players);
}

// Function to check if top 10 rankings have changed
function checkTop10Changes(newTop10) {
    // If we don't have previous data, consider it as changed
    if (previousTop10.length === 0) return true;
    
    // Compare each player in top 10
    return newTop10.some((player, index) => {
        const prevPlayer = previousTop10[index];
        return !prevPlayer || 
               prevPlayer.name !== player.name || 
               prevPlayer.score !== player.score ||
               prevPlayer.rank !== player.rank;
    });
}

// Update game status display
function updateGameStatus(status) {
    const gameStatusDiv = document.getElementById('gameStatus');
    const gameStatusMessage = document.getElementById('gameStatusMessage');
    const lastGameInfo = document.getElementById('lastGameInfo');
    const slotTabs = document.getElementById('slotTabs');
    
    if (!gameStatusDiv || !gameStatusMessage || !lastGameInfo) return;

    // Hide slot tabs if no slots exist
    if (slotTabs) {
        slotTabs.style.display = status.hasSlots ? 'flex' : 'none';
    }
    
    if (!status.hasSlots) {
        // No slots exist yet - show waiting message
        gameStatusDiv.className = 'game-status no-slots';
        gameStatusDiv.style.display = 'block';
        gameStatusMessage.textContent = 'Waiting for game session to start...';
        lastGameInfo.style.display = 'none';
        lastGameInfo.innerHTML = '';
        // Hide leaderboard components when no slots
        hideLeaderboardComponents();
        // Hide any game running message
        hideGameRunningMessage();
        // Only clear dashboard if we actually need to (prevent endless loop)
        if (allPlayers.length > 0) {
            clearDashboard();
        }
    } else if (status.active) {
        // Active game session - hide the game status message completely
        gameStatusDiv.style.display = 'none';
        lastGameInfo.style.display = 'none';
        lastGameInfo.innerHTML = '';
        
        // For active games, immediately show "Game is Running!" message
        // The leaderboard components will be shown only when we have actual player data
        // This prevents showing empty podium boxes and table while waiting for data
        if (allPlayers.length === 0 && allPlayersFull.length === 0) {
            console.log('Active game detected with no players, showing game running message');
            showGameRunningMessage();
        } else {
            // We have player data, show leaderboard components
            showLeaderboardComponents();
            hideGameRunningMessage();
        }
        
        // The showGameRunningMessage() will be called separately if no players
    } else {
        // Inactive game session - show the status message
        gameStatusDiv.className = 'game-status inactive';
        gameStatusDiv.style.display = 'block';
        gameStatusMessage.textContent = status.message || 'Game session has ended';
        lastGameInfo.style.display = 'none';
        lastGameInfo.innerHTML = '';
        
        // Keep leaderboard components visible when game ends if we have player data
        // This ensures users can see the final results without needing to refresh
        if (allPlayers.length > 0 || allPlayersFull.length > 0) {
            console.log('Game ended but keeping leaderboard visible with final results');
            showLeaderboardComponents();
            // Add class for more compact styling when leaderboard is shown
            gameStatusDiv.className = 'game-status inactive with-leaderboard';
        } else {
            // Only hide leaderboard if there's truly no data
            hideLeaderboardComponents();
        }
        
        // Hide any game running message when showing inactive status
        hideGameRunningMessage();
        
        // Add winners information if available
        let infoHTML = '';
        if (status.winners && status.winners.length > 0) {
            infoHTML += '<div class="winners-section"><h3>🏆 Game Winners 🏆</h3><ul>';
            status.winners.forEach((winner, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                infoHTML += `<li>${medal} ${winner.name} - Score: ${winner.score} (${winner.displaytime})</li>`;
            });
            infoHTML += '</ul></div>';
        }
        
        if (status.lastSlotInfo) {
            const lastSlot = status.lastSlotInfo;
            const startDate = new Date(lastSlot.start_time.replace(' ', 'T'));
            const endDate = new Date(lastSlot.end_time.replace(' ', 'T'));
            
            infoHTML += `
                <div class="last-game-section">
                    <h3>Last Session Details</h3>
                    <p>Session: <strong>${lastSlot.name}</strong></p>
                    <p>Started: ${startDate.toLocaleTimeString()}</p>
                    <p>Ended: ${endDate.toLocaleTimeString()}</p>
                    <p>Duration: ${lastSlot.duration}</p>
                </div>
            `;
        }
        
        lastGameInfo.innerHTML = infoHTML;
        lastGameInfo.style.display = infoHTML ? 'block' : 'none';
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Add scroll event listener for infinite scrolling
    window.addEventListener('scroll', handleScroll);

    // Add event listeners for location buttons
    document.querySelectorAll('.location-button').forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const location = button.getAttribute('data-location');
            selectLocation(location);
        });
    });

    // Add event listener for change location button
    document.getElementById('changeLocationBtn').addEventListener('click', (e) => {
        e.preventDefault();
        showLocationSelector();
    });

    // Load saved location if exists
    const savedLocation = localStorage.getItem('selectedLocation');
    if (savedLocation) {
        selectLocation(savedLocation);
    }
});

// Helper functions to hide/show leaderboard components
function hideLeaderboardComponents() {
    const podiumSection = document.querySelector('.podium-section');
    const leaderboardTable = document.querySelector('.leaderboard-table');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    
    if (podiumSection) {
        podiumSection.style.display = 'none';
    }
    if (leaderboardTable) {
        leaderboardTable.style.display = 'none';
    }
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
    if (loadMoreBtn) {
        loadMoreBtn.style.display = 'none';
    }
}

function showLeaderboardComponents() {
    const podiumSection = document.querySelector('.podium-section');
    const leaderboardTable = document.querySelector('.leaderboard-table');
    
    if (podiumSection) {
        podiumSection.style.display = 'block';
    }
    if (leaderboardTable) {
        leaderboardTable.style.display = 'table';
    }
}
