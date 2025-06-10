import { Component, QueryList, ViewChildren, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LeaderboardServiceMock } from '../services/leaderboardservicemock';

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

  constructor(private leaderboardService: LeaderboardServiceMock) {}

  ngOnInit(): void {
    // Fetch leaderboard data and update regularly
    this.leaderboardService.getLeaderboardData().subscribe((data) => {
      this.filteredData = data; // Update leaderboard data
      this.triggerSortingAnimations(); // Sort and animate
    });
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
}