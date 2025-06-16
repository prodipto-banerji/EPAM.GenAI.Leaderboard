// WebSocket connection
let ws;
let currentLocation = null;

// Store previous top 3 players
let previousTop3 = [];

// Infinite scroll state
let allPlayers = [];
let displayedPlayers = 0;
const playersPerLoad = 7; // Number of players to load each time
const initialTableSize = 7; // Number of players to show in table initially
let isLoading = false; // Flag to prevent multiple simultaneous loads

// Location handling functions
function selectLocation(location) {
    // Clear current data first
    clearDashboard();
    
    // Update location in localStorage
    localStorage.setItem('selectedLocation', location);
    
    // Set current location
    currentLocation = location;
    
    // Connect to WebSocket and fetch data before updating UI
    refreshDashboard(location);
}

function showLocationSelector() {
    document.getElementById('locationSelector').classList.remove('hidden');
}

// Clear dashboard data
function clearDashboard() {
    const podiumContainer = document.getElementById('podiumContainer');
    const tbody = document.querySelector('.leaderboard-table tbody');
    podiumContainer.innerHTML = '';
    tbody.innerHTML = '';
}

// WebSocket connection management
function connectWebSocket(location) {
    return new Promise((resolve, reject) => {
        // Close existing connection if any
        if (ws) {
            ws.close();
        }

        // Connect to WebSocket server
        ws = new WebSocket('ws://localhost:8080');

        ws.onopen = () => {
            console.log('Connected to WebSocket server');
            // Send location preference
            ws.send(JSON.stringify({
                type: 'setLocation',
                location: location
            }));
            resolve();
        };        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'rankings' && location === currentLocation) {
                const players = message.data;
                // Check for real changes in top 3
                const top3 = players.slice(0, 3);
                checkForPositionChanges(top3);
                
                // Update podium with top 3
                updatePodium(top3, location);
                
                // Store remaining players for scroll-based updates
                allPlayers = players.slice(3);
                
                // Only update initial table view if no players are displayed yet
                if (displayedPlayers === 0) {
                    updateTableDisplay();
                }
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            reject(error);
        };

        ws.onclose = () => {
            console.log('Disconnected from WebSocket server');
            // Attempt to reconnect after 5 seconds
            setTimeout(() => {
                if (currentLocation) {
                    connectWebSocket(currentLocation);
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
    
    // Center horizontally and position above the target
    celebration.style.left = '50%';
    celebration.style.top = `${Math.max(20, y - 100)}px`;
    celebration.style.transform = 'translateX(-50%)';
    
    // Add emojis for extra flair
    celebration.innerHTML = `✨ ${text} ✨`;
    
    document.body.appendChild(celebration);
    
    // Remove celebration text after animation
    setTimeout(() => celebration.remove(), 2000);
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

// Load more players
function loadMorePlayers() {
    const tbody = document.querySelector('.leaderboard-table tbody');
    if (!tbody) return;

    const start = displayedPlayers;
    const end = displayedPlayers === 0 
        ? Math.min(initialTableSize, allPlayers.length)  // Load initial 7 players
        : Math.min(start + playersPerLoad, allPlayers.length);  // Load next batch on scroll
    
    // Add new players
    for (let i = start; i < end; i++) {
        const player = allPlayers[i];
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${i + 4}</td>
            <td>
                <div class="player-row">
                    <img class="player-avatar" src="${getDefaultAvatar(player.name)}" alt="${player.name}">
                    ${player.name}
                </div>
            </td>
            <td>${player.score}</td>
            <td>${player.displaytime}</td>
        `;

        // Add fade-in animation
        row.style.opacity = '0';
        row.style.animation = 'fadeIn 0.5s forwards';
    }
    
    displayedPlayers = end;

    // Update loading indicator visibility
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.style.display = displayedPlayers < allPlayers.length ? 'block' : 'none';
    }
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
    tbody.innerHTML = '';
    displayedPlayers = 0;

    // If no players after top 3, hide table
    if (allPlayers.length === 0) {
        toggleTableVisibility(false);
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
        const response = await fetch(`http://localhost:8080/api/rankings/${location}`);
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
}

function updateDashboard(players, location) {
    // Only update if this is for the current location
    if (location !== currentLocation) {
        return;
    }

    // Get top 3 players and check for changes
    const top3 = players.slice(0, 3);
    checkForPositionChanges(top3);
    
    // Update podium with top 3
    updatePodium(top3, location);
    
    // Store remaining players for infinite scrolling
    allPlayers = players.slice(3);
    displayedPlayers = 0;

    // Update table with remaining players
    updateTableDisplay();
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
