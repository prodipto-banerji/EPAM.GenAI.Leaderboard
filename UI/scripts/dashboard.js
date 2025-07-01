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
let userSelectedSlot = false; // Flag to track if user manually selected a slot

// Debounce flag to prevent multiple rapid WebSocket requests
let lastRequestTime = 0;
const REQUEST_DEBOUNCE_MS = 1000; // 1 second debounce

// Debounce game state changes to prevent infinite loops
let lastGameStateChangeTime = 0;
const GAME_STATE_CHANGE_DEBOUNCE_MS = 2000; // 2 second debounce for game state changes

// Cache last processed data to prevent duplicate processing
let lastProcessedDataHash = null;

// Rate limiting for getGameStatus requests
let lastGameStatusRequestTime = 0;
const GAME_STATUS_REQUEST_DEBOUNCE_MS = 1000; // 1 second between game status requests

// Debug counters
let gameStatusRequestCount = 0;
let gameStatusResponseCount = 0;

function selectLocation(location) {
    // Clear current data first
    clearDashboard();
    
    // Reset user selection flag when changing location
    userSelectedSlot = false;
    
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
    
    // Reset all player arrays and slot selection
    allPlayers = [];
    allPlayersFull = [];
    displayedPlayers = 0;
    previousTop3 = [];
    previousTop10 = [];
    userSelectedSlot = false; // Reset user selection when clearing dashboard
    
    // Reset slot-related state
    currentSlotId = null;
    slots = [];
    
    // Reset data processing state
    lastProcessedDataHash = null;
    
    // Hide leaderboard components when clearing
    hideLeaderboardComponents();
    
    // Hide any game running message
    hideGameRunningMessage();
    
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
            requestGameStatus(); // Use rate-limited function
            resolve(ws);
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'rankings':
                    if (data.location === currentLocation) {
                        // Check if the rankings data is for the current slot
                        if (data.slotId && currentSlotId && data.slotId !== currentSlotId) {
                            console.log(`Ignoring rankings data for slot ${data.slotId}, current slot is ${currentSlotId}`);
                            break;
                        }
                        
                        // Generate a simple hash to check if data has changed
                        const dataHash = JSON.stringify(data.players.slice(0, 10));
                        if (dataHash !== lastProcessedDataHash) {
                            lastProcessedDataHash = dataHash;
                            console.log('Updating dashboard with new rankings for slot:', data.slotId || 'default', 'players:', data.players);
                            // If data.updatedPlayer exists, pass it; else, pass null
                            updateDashboard(data.players, data.location, data.updatedPlayer || null);
                        } else {
                            console.log('Skipping duplicate data processing');
                        }
                    }
                    break;

                case 'gameStatus':
                    gameStatusResponseCount++;
                    console.log(`Received game status update #${gameStatusResponseCount}:`, data.status);
                    const previousActiveSlotId = currentSlotId;
                    const wasGameActive = previousGameActive;
                    
                    updateGameStatus(data.status);

                    if (data.status.slots) {
                        // Force update slot tabs with fresh data
                        updateSlotTabs(data.status.slots, data.status.activeSlotId);
                        
                        // Check if the active slot has changed (game ended) or game status changed
                        const gameStateChanged = (previousActiveSlotId && previousActiveSlotId !== data.status.activeSlotId) ||
                                               (wasGameActive !== data.status.active);
                        
                        // Add debouncing to prevent rapid state change processing
                        const now = Date.now();
                        const shouldProcessStateChange = gameStateChanged && (now - lastGameStateChangeTime > GAME_STATE_CHANGE_DEBOUNCE_MS);
                        
                        if (shouldProcessStateChange) {
                            console.log('Game state changed - refreshing slot tabs (debounced)');
                            lastGameStateChangeTime = now;
                            
                            // Multiple refresh attempts to ensure color changes are applied
                            setTimeout(() => {
                                console.log('First refresh of slot tabs');
                                updateSlotTabs(data.status.slots, data.status.activeSlotId);
                                forceSlotTabColorUpdate();
                            }, 100);
                            setTimeout(() => {
                                console.log('Second refresh of slot tabs');
                                updateSlotTabs(data.status.slots, data.status.activeSlotId);
                                forceSlotTabColorUpdate();
                            }, 300);
                            setTimeout(() => {
                                console.log('Final refresh of slot tabs');
                                updateSlotTabs(data.status.slots, data.status.activeSlotId);
                                forceSlotTabColorUpdate();
                                
                                // After slot tabs are updated, check if we need to show "no players" message
                                // for a slot that just became inactive with no players
                                // BUT ONLY if there are actually slots (hasSlots is true)
                                if (!data.status.active && data.status.hasSlots && (allPlayers.length === 0 && allPlayersFull.length === 0)) {
                                    console.log('Game just ended with no players, showing no players message');
                                    showGameRunningMessage(false); // Show "no players" message
                                }
                            }, 500);
                        } else if (gameStateChanged) {
                            console.log('Game state changed but skipping due to debounce');
                        }
                        
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


// Helper function to request game status with rate limiting
function requestGameStatus() {
    const now = Date.now();
    if (now - lastGameStatusRequestTime > GAME_STATUS_REQUEST_DEBOUNCE_MS) {
        lastGameStatusRequestTime = now;
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('Requesting game status (rate limited)');
            gameStatusRequestCount++; // Increment request counter
            ws.send(JSON.stringify({ type: 'getGameStatus' }));
            return true;
        }
    } else {
        console.log('Game status request skipped due to rate limiting');
    }
    return false;
}

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
    function updateSlotTabs(slotsData, activeSlotId, userSelectedSlotId = null) {
        console.log('Updating slot tabs with data:', slotsData, 'activeSlotId:', activeSlotId, 'userSelectedSlotId:', userSelectedSlotId, 'userSelectedSlot flag:', userSelectedSlot);
        const slotTabs = document.getElementById('slotTabs');
        slots = slotsData;
        
        // Priority order for slot selection:
        // 1. User manually selected slot (userSelectedSlotId)
        // 2. Currently selected slot (currentSlotId) if user previously selected it and it still exists
        // 3. Active slot (activeSlotId) - only if user hasn't manually selected a different slot
        // 4. Latest slot (first in sorted list) - only as initial fallback
        
        let targetSlotId = null;
        
        if (userSelectedSlotId) {
            // User manually selected a slot - this takes highest priority
            targetSlotId = userSelectedSlotId;
            userSelectedSlot = true;
            console.log('Using user selected slot:', targetSlotId);
        } else if (userSelectedSlot && currentSlotId && slots.find(slot => slot.id === currentSlotId)) {
            // Keep current slot if user previously selected it and it still exists
            targetSlotId = currentSlotId;
            console.log('Keeping user-selected slot:', targetSlotId);
        } else if (!userSelectedSlot && activeSlotId) {
            // Use active slot only if user hasn't manually selected a different slot
            targetSlotId = activeSlotId;
            console.log('Using active slot (no user selection):', targetSlotId);
        } else if (!userSelectedSlot && !currentSlotId && slots.length > 0) {
            // Fall back to latest slot only as initial load when nothing is selected
            targetSlotId = slots[0].id;
            console.log('Using latest slot as initial fallback:', targetSlotId);
        } else if (currentSlotId && slots.find(slot => slot.id === currentSlotId)) {
            // Keep existing currentSlotId if it's valid
            targetSlotId = currentSlotId;
            console.log('Keeping existing current slot:', targetSlotId);
        }
        
        // Update currentSlotId and track if it changed
        const previousSlotId = currentSlotId;
        if (targetSlotId) {
            currentSlotId = targetSlotId;
        }
        
        slotTabs.innerHTML = '';
        slots.forEach(slot => {
            let tabClass = 'slot-tab';
            if (slot.id === currentSlotId) tabClass += ' active';
            if (slot.status === 'active') tabClass += ' active-slot';
            if (slot.status === 'completed') tabClass += ' inactive-slot';
            
            console.log(`Slot ${slot.id} status: ${slot.status}, classes: ${tabClass}`);
            
            const tab = document.createElement('button');
            tab.className = tabClass;
            let statusDot = '<span class="status-dot"></span>';
            
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
                <div class="slot-name-time" title="${slot.name} - ${startTimeString}">
                    ${statusDot} ${slot.name} - ${startTimeString}
                </div>
            `;
            tab.onclick = () => {
                console.log('User clicked on slot:', slot.id);
                
                // Check if user clicked on the same slot that's already selected
                if (currentSlotId === slot.id) {
                    console.log('User clicked on already selected slot, ignoring duplicate click');
                    return; // Do nothing if same slot is clicked
                }
                
                console.log('Slot changed from', currentSlotId, 'to', slot.id);
                userSelectedSlot = true; // Mark that user manually selected a slot
                const previousSlotId = currentSlotId; // Store previous slot ID
                currentSlotId = slot.id;
                
                // Only load data and update dashboard if switching to a different slot
                if (previousSlotId !== slot.id) {
                    loadSlotData(slot.id);
                    // Pass the user selected slot ID to prevent override
                    updateSlotTabs(slots, null, slot.id);
                }
            };
            slotTabs.appendChild(tab);
        });
        
        // Auto-load data if slot changed or if this is initial load (previousSlotId was null)
        if (targetSlotId && (targetSlotId !== previousSlotId || previousSlotId === null)) {
            console.log('Auto-loading data for slot:', targetSlotId, '(previous:', previousSlotId, ')');
            loadSlotData(targetSlotId);
        }
    }

// Load data for a specific slot
async function loadSlotData(slotId) {
    try {
        console.log('Loading data for slot:', slotId);
        
        // Validate slotId
        if (!slotId) {
            console.warn('No slot ID provided, skipping data load');
            return;
        }
        
        // Check if there are any slots at all
        if (!slots || slots.length === 0) {
            console.log('No slots available, showing waiting message');
            showGameRunningMessage(false, true); // isActiveGame=false, isNoSlotsState=true
            return;
        }
        
        // Clear any existing data to prevent showing data from other slots
        allPlayers = [];
        allPlayersFull = [];
        displayedPlayers = 0;
        
        // Clear UI components
        const podiumContainer = document.getElementById('podiumContainer');
        const tbody = document.querySelector('.leaderboard-table tbody');
        if (podiumContainer) {
            podiumContainer.innerHTML = '';
        }
        if (tbody) {
            tbody.innerHTML = '';
        }
        
        currentSlotId = slotId;

        // Check if this is an active slot by looking at our slots data
        const activeSlot = slots.find(slot => slot.id === slotId && slot.status === 'active');
        
        if (activeSlot) {
            // If we're loading an active slot and have no player data, show game running message
            // This prevents showing empty podium while data loads
            console.log('Loading active slot, showing game running message');
            showGameRunningMessage(true); // Active game
        } else {
            // For inactive slots, show appropriate message immediately
            console.log('Loading inactive slot, showing no players message');
            showGameRunningMessage(false); // Inactive slot
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
        
        // Clear any existing data to prevent showing stale data
        clearDashboard();
        
        // Connect to WebSocket first
        await connectWebSocket(location);
        
        // Don't fetch initial rankings immediately - wait for game status to determine the correct slot
        // The WebSocket will send game status which will trigger the appropriate slot selection
        // and then fetch the correct rankings data
        console.log('WebSocket connected, waiting for game status to determine correct slot...');

        // Update location display
        document.getElementById('currentLocation').textContent = location;
    } catch (error) {
        console.error('Error loading initial data:', error);
        document.getElementById('currentLocation').textContent = location;
        // Let the game status logic handle the display
        hideLeaderboardComponents();
    }
}

// Show appropriate message when no players have played yet
function showGameRunningMessage(isActiveGame = true, isNoSlotsState = false) {
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
    
    // Create different messages based on game status
    const gameRunningDiv = document.createElement('div');
    gameRunningDiv.id = 'gameRunningMessage';
    
    if (isNoSlotsState) {
        // No slots exist - show waiting for game to start message
        gameRunningDiv.className = 'no-players-message'; // Use same styling as "Session Completed"
        gameRunningDiv.innerHTML = `
            <div class="no-players-content">
                <div class="no-players-icon">⏳</div>
                <h2>Waiting for game session to start...</h2>
                <p>No game sessions are currently available</p>
                <div class="try-next-prompt">
                    <span class="try-text">Stay tuned!</span>
                    <div class="scan-qr">👉 Game sessions will appear here when available!</div>
                </div>
            </div>
        `;
    } else if (isActiveGame) {
        // Active game - show game running message
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
    } else {
        // Inactive/closed game - show no players message
        gameRunningDiv.className = 'no-players-message';
        gameRunningDiv.innerHTML = `
            <div class="no-players-content">
                <div class="no-players-icon">😴</div>
                <h2>Session Completed</h2>
                <p>No one played in this session</p>
                <div class="try-next-prompt">
                    <span class="try-text">Maybe next time!</span>
                    <div class="scan-qr">👉 Scan the QR code to join future games!</div>
                </div>
            </div>
        `;
    }
    
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

// Show message when table is hidden due to low player count
function showTableHiddenMessage() {
    const leaderboardTable = document.querySelector('.leaderboard-table');
    if (leaderboardTable) {
        // Check if message already exists
        let messageDiv = document.querySelector('.table-hidden-message');
        if (!messageDiv) {
            messageDiv = document.createElement('div');
            messageDiv.className = 'table-hidden-message';
            messageDiv.style.cssText = `
                text-align: center;
                padding: 20px;
                margin: 20px auto;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                color: #fff;
                font-size: 16px;
                max-width: 400px;
                border: 1px solid rgba(255, 255, 255, 0.2);
            `;
            messageDiv.innerHTML = '📊 Leaderboard table will appear when more than 3 players join the game';
            
            // Insert after the podium section
            const podiumSection = document.querySelector('.podium-section');
            if (podiumSection && podiumSection.parentNode) {
                // podiumSection.parentNode.insertBefore(messageDiv, leaderboardTable);
            }
        }
        messageDiv.style.display = 'block';
    }
}

// Hide the table hidden message
function hideTableHiddenMessage() {
    const messageDiv = document.querySelector('.table-hidden-message');
    if (messageDiv) {
        messageDiv.style.display = 'none';
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
        // Check if current slot is active or not
        const currentSlot = slots.find(slot => slot.id === currentSlotId);
        const isActiveSlot = currentSlot && currentSlot.status === 'active';
        console.log('No players found. Current slot:', currentSlot, 'Is active:', isActiveSlot);
        
        // Always show appropriate message based on slot status
        showGameRunningMessage(isActiveSlot);
        return;
    }
    
    // Hide the game running message if it exists
    hideGameRunningMessage();
    
    // Check if we have 3 or fewer players - only show podium, hide table
    if (players.length <= 3) {
        console.log(`Only ${players.length} players, showing podium only (hiding table)`);
        showPodiumOnly();
        
        // Show all players in podium (up to 3)
        updatePodium(players, location);
        
        // Clear table and hide load more
        const tbody = document.querySelector('.leaderboard-table tbody');
        if (tbody) {
            tbody.innerHTML = '';
        }
        allPlayers = [];
        displayedPlayers = 0;
        showLoadMoreButton(false);
        
        // Check for position changes
        checkForPositionChanges(players);
        return;
    }
    
    // Show leaderboard components since we have more than 3 players
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
let previousGameActive = null; // Track previous game active state

function updateGameStatus(status) {
    const gameStatusDiv = document.getElementById('gameStatus');
    const gameStatusMessage = document.getElementById('gameStatusMessage');
    const lastGameInfo = document.getElementById('lastGameInfo');
    const slotTabs = document.getElementById('slotTabs');
    
    if (!gameStatusDiv || !gameStatusMessage || !lastGameInfo) return;

    // Check if game just transitioned from active to inactive
    const gameJustEnded = previousGameActive === true && status.active === false;
    previousGameActive = status.active;
    
    if (gameJustEnded) {
        console.log('Game just ended, forcing slot tabs refresh');
        // Force refresh of slot tabs to ensure color changes are applied
        if (status.slots) {
            setTimeout(() => {
                updateSlotTabs(status.slots, status.activeSlotId);
                forceSlotTabColorUpdate();
            }, 50);
        }
    }

    // Hide slot tabs if no slots exist
    if (slotTabs) {
        slotTabs.style.display = status.hasSlots ? 'flex' : 'none';
    }
    
    if (!status.hasSlots) {
        console.log('No slots detected - showing waiting message');
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
        console.log('Game is active - handling active state');
        // Active game session - hide the game status message completely
        gameStatusDiv.style.display = 'none';
        lastGameInfo.style.display = 'none';
        lastGameInfo.innerHTML = '';
        
        // For active games, immediately show "Game is Running!" message
        // The leaderboard components will be shown only when we have actual player data
        // This prevents showing empty podium boxes and table while waiting for data
        if (allPlayers.length === 0 && allPlayersFull.length === 0) {
            console.log('Active game detected with no players, showing game running message');
            showGameRunningMessage(true); // Active game
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
        
        // For inactive games, check if we have player data to determine what to show
        if (allPlayers.length > 0 || allPlayersFull.length > 0) {
            console.log('Game ended but keeping leaderboard visible with final results');
            showLeaderboardComponents();
            // Add class for more compact styling when leaderboard is shown
            gameStatusDiv.className = 'game-status inactive with-leaderboard';
            // Hide any no-players message since we have data
            hideGameRunningMessage();
        } else {
            // No player data - show appropriate message for inactive slot
            console.log('Game ended with no players, showing no players message');
            hideLeaderboardComponents();
            
            // Immediately show "no players" message for completed slots
            if (gameJustEnded || (currentSlotId && slots.find(slot => slot.id === currentSlotId && slot.status === 'completed'))) {
                console.log('Showing no players message for completed slot');
                showGameRunningMessage(false); // Show "no players" message
            }
        }
        
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
    
    // Also hide the table hidden message
    hideTableHiddenMessage();
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
    
    // Hide the table hidden message when showing full leaderboard
    hideTableHiddenMessage();
}

// Show only podium section (hide table)
function showPodiumOnly() {
    const podiumSection = document.querySelector('.podium-section');
    const leaderboardTable = document.querySelector('.leaderboard-table');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    
    if (podiumSection) {
        podiumSection.style.display = 'block';
    }
    if (leaderboardTable) {
        leaderboardTable.style.display = 'none';
    }
    if (loadMoreBtn) {
        loadMoreBtn.style.display = 'none';
    }
    
    // Show message explaining why table is hidden
    showTableHiddenMessage();
}

// Show/hide just the leaderboard table
function showLeaderboardTable(show = true) {
    const leaderboardTable = document.querySelector('.leaderboard-table');
    if (leaderboardTable) {
        leaderboardTable.style.display = show ? 'table' : 'none';
    }
}

// Helper function to force slot tab color updates
function forceSlotTabColorUpdate() {
    console.log('Forcing slot tab color update');
    const slotTabElements = document.querySelectorAll('.slot-tab');
    slotTabElements.forEach((tab) => {
        // Find the corresponding slot data by checking the tab's position
        const slotNameElement = tab.querySelector('.slot-name-time');
        if (slotNameElement) {
            const tabText = slotNameElement.textContent;
            // Find matching slot by name
            const matchingSlot = slots.find(slot => tabText.includes(slot.name));
            
            if (matchingSlot) {
                // Remove all status classes
                tab.classList.remove('active-slot', 'inactive-slot');
                
                // Re-add the correct status class based on current slot data
                if (matchingSlot.status === 'active') {
                    tab.classList.add('active-slot');
                    console.log(`Set slot ${matchingSlot.id} to active (green)`);
                } else if (matchingSlot.status === 'completed') {
                    tab.classList.add('inactive-slot');
                    console.log(`Set slot ${matchingSlot.id} to completed (red)`);
                }
            }
        }
    });
}

// Test function to verify slot selection behavior - can be called from browser console
function testSlotSelection() {
    console.log('=== Slot Selection Test ===');
    console.log('Current slots:', slots.map(s => ({ id: s.id, name: s.name, status: s.status })));
    console.log('Current slot ID:', currentSlotId);
    console.log('User selected slot flag:', userSelectedSlot);
    console.log('Total slot tabs:', document.querySelectorAll('.slot-tab').length);
    console.log('Game status requests:', gameStatusRequestCount);
    console.log('Game status responses:', gameStatusResponseCount);
    console.log('Total players:', allPlayersFull?.length || 0);
    console.log('Players in current view:', allPlayers?.length || 0);
    
    const activeTab = document.querySelector('.slot-tab.active');
    if (activeTab) {
        const tabText = activeTab.querySelector('.slot-name-time')?.textContent;
        console.log('Active tab text:', tabText);
    }
    
    const tableVisible = document.querySelector('.leaderboard-table')?.style.display !== 'none';
    const podiumVisible = document.querySelector('.podium-section')?.style.display !== 'none';
    console.log('Table visible:', tableVisible);
    console.log('Podium visible:', podiumVisible);
    
    return {
        slots: slots,
        currentSlotId: currentSlotId,
        userSelectedSlot: userSelectedSlot,
        activeTabText: activeTab?.querySelector('.slot-name-time')?.textContent,
        gameStatusRequestCount: gameStatusRequestCount,
        gameStatusResponseCount: gameStatusResponseCount,
        totalPlayers: allPlayersFull?.length || 0,
        currentViewPlayers: allPlayers?.length || 0,
        tableVisible: tableVisible,
        podiumVisible: podiumVisible
    };
}

// Expose function to global scope for testing
window.testSlotSelection = testSlotSelection;
