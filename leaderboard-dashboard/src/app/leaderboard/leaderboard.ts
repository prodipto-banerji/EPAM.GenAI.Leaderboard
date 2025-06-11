import { Component, QueryList, ViewChildren, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LeaderboardServiceMock } from '../services/leaderboardservicemock';
import { LeaderboardRealtimeService, SAMPLE_LEADERBOARD_DATA } from '../services/leaderboardrealtimeservice';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './leaderboard.html',
  styleUrls: ['./leaderboard.css'],
  providers: [LeaderboardServiceMock],
})
export class LeaderboardComponent implements AfterViewInit {
  @ViewChildren('playerCard') playerCards!: QueryList<ElementRef>; // Access all player cards
  filteredData: any[] = []; // Leaderboard data
  previousPositions: Map<number, { top: number }> = new Map(); // Tracks previous positions for each player card element

  constructor(private leaderboardService: LeaderboardServiceMock, private realtimeService: LeaderboardRealtimeService) {}

  ngOnInit(): void {
    // Subscribe to real-time updates
    this.realtimeService.onLeaderboardUpdate().subscribe((data) => {
      if (data) {
        this.updateLeaderboardWithServerData(data);
      }
    });
    // Fallback: fetch initial data if no real-time yet
    this.leaderboardService.getLeaderboardData().subscribe((data) => {
      if (!this.filteredData.length) {
        this.filteredData = data;
        this.triggerSortingAnimations();
      }
    });
  }

  // Example: Push sample data to the server (call this from a button or ngOnInit for testing)
  pushSampleData() {
    this.realtimeService.pushData(SAMPLE_LEADERBOARD_DATA);
  }

  ngAfterViewInit(): void {
    // Initially record positions after DOM renders
    setTimeout(() => this.recordPositions(), 0);
  }

  /**
   * 1. Records the current positions of all visible player cards.
   */
  recordPositions(): void {
    this.previousPositions.clear();
    this.playerCards.forEach((card) => {
      const rect = card.nativeElement.getBoundingClientRect();
      const id = Number(card.nativeElement.getAttribute('data-id')); // Match using unique ID for each player
      this.previousPositions.set(id, { top: rect.top });
    });
  }

  /**
   * 2. Animates player cards when their positions shift due to sorting.
   */
  animateSorting(): void {
    const newPositions: Map<number, { top: number }> = new Map();

    this.playerCards.forEach((card) => {
      const rect = card.nativeElement.getBoundingClientRect();
      const id = Number(card.nativeElement.getAttribute('data-id'));
      newPositions.set(id, { top: rect.top });

      const previous = this.previousPositions.get(id); // Compare the player's previous position
      if (previous) {
        const deltaY = previous.top - rect.top; // Calculate position change

        if (deltaY !== 0) { // Only move if positions have changed
          const element = card.nativeElement as HTMLElement;
          element.style.transition = 'none';
          element.style.transform = `translateY(${deltaY}px)`;
          element.getBoundingClientRect(); // Force reflow for transition
          element.style.transition = 'transform 0.5s ease-in-out';
          element.style.transform = `translateY(0)`; // Reset position to 0
        }
      }
    });

    // Update positions after the animation completes
    setTimeout(() => {
      this.previousPositions = new Map(newPositions);
    }, 500); // Wait for transition duration to complete
  }

  /**
   * 3. Sorts the player list, records positions, then animates sorting.
   */
  triggerSortingAnimations(): void {
    this.recordPositions(); // Capture current positions before sorting
    setTimeout(() => { // Ensure DOM updates complete before `animateSorting`
      this.sortLeaderboard();
      this.animateSorting(); // Trigger animations after sorting
    }, 100); // Delay allows Angular to process DOM updates
  }

  /**
   * Sorts leaderboard data and assigns new ranks.
   */
  sortLeaderboard(): void {
    this.filteredData.forEach((game) => {
      game.leaderboard.forEach((locationData: any) => {
        locationData.players = this.getTopPlayers(locationData.players); // Sort and rank
      });
    });
  }

  /**
   * Sorts players by score in descending order and assigns ranks.
   */
  getTopPlayers(players: any[]): any[] {
    return players
      .sort((a, b) => b.score - a.score) // Sort descending by score
      .map((player, index) => ({
        ...player,
        rank: index + 1, // Assign rank based on index
      }));
  }

  /**
   * Helps Angular efficiently render DOM elements by keeping track of player IDs.
   */
  trackByPlayerId(index: number, player: any): number {
    return player.id; // Return unique ID to track players
  }

  // Update leaderboard with new data from server, merging scores and keeping top 5 players
  updateLeaderboardWithServerData(serverData: any[]) {
    if (!Array.isArray(serverData)) return;
    // For each game in the server data
    serverData.forEach((serverGame: any) => {
      // Find the matching game in the current filteredData
      const localGame = this.filteredData.find(g => g.game === serverGame.game);
      if (localGame) {
        // For each location in the server data
        serverGame.leaderboard.forEach((serverLoc: any) => {
          // Find the matching location in the local data
          const localLoc = localGame.leaderboard.find((l: any) => l.location === serverLoc.location);
          if (localLoc) {
            // Merge players by id, updating score if server score is higher
            serverLoc.players.forEach((serverPlayer: any) => {
              const localPlayerIdx = localLoc.players.findIndex((p: any) => p.id === serverPlayer.id);
              if (localPlayerIdx !== -1) {
                const localPlayer = localLoc.players[localPlayerIdx];
                if (serverPlayer.score > localPlayer.score) {
                  // Remove the old player from the list
                  localLoc.players.splice(localPlayerIdx, 1);
                  // Insert the updated player (with new score and name)
                  localLoc.players.push({ ...serverPlayer });
                }
                // If the incoming score is not higher, do nothing
              } else {
                // If player not found locally, add them
                localLoc.players.push({ ...serverPlayer });
              }
            });
            // Sort players by score descending
            localLoc.players = localLoc.players.sort((a: any, b: any) => b.score - a.score);
            // If more than 5 players, remove the last (lowest score) player(s)
            while (localLoc.players.length > 5) {
              localLoc.players.pop();
            }
            // Re-assign ranks
            localLoc.players = localLoc.players.map((player: any, idx: number) => ({ ...player, rank: idx + 1 }));
          }
        });
      }
    });
    this.triggerSortingAnimations();
  }
}
