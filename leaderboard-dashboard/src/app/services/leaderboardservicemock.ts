import { Injectable } from '@angular/core';
import { Observable, interval } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class LeaderboardServiceMock {
  private games = ['Game A', 'Game B', 'Game C']; // List of games
  private locations = ['Location 1', 'Location 2', 'Location 3']; // List of locations
  private playersPerLocation = 5; // Number of players per location
  private playerIdCounter = 1; // Counter for unique player IDs

  // Store and persist dynamic leaderboard data
  private leaderboard: any[] = this.generateInitialData();

  // Generate initial data with unique IDs and fixed names
  private generateInitialData(): any[] {
    return this.games.map((game) => ({
      game: game,
      leaderboard: this.locations.map((location) => ({
        location: location,
        players: Array.from({ length: this.playersPerLocation }, () => ({
          id: this.playerIdCounter++, // Assign unique sequential ID
          rank: 0, // Placeholder rank; will be set dynamically
          name: `Player ${this.playerIdCounter}`, // Fixed name for each player
          score: Math.floor(Math.random() * 1000), // Initial random score
        })),
      })),
    }));
  }

  // Simulate score changes without regenerating IDs/names
  private updateLeaderboard(): any[] {
    return this.leaderboard.map((game) => ({
      game: game.game,
      leaderboard: game.leaderboard.map((locationData: { location: any; players: any[]; }) => ({
        location: locationData.location,
        players: locationData.players
          .map((player) => ({
            ...player,
            score: player.score + Math.floor(Math.random() * 200) - 100, // Scores go up or down randomly
          }))
          .sort((a, b) => b.score - a.score) // Sort players by updated scores
          .map((player, index) => ({
            ...player,
            rank: index + 1, // Update rank after sorting
          })),
      })),
    }));
  }

  // Observable that emits leaderboard updates every 3 seconds
  getLeaderboardData(): Observable<any[]> {
    return interval(3000).pipe(
      map(() => {
        this.leaderboard = this.updateLeaderboard(); // Update leaderboard
        return this.leaderboard; // Emit updated data
      })
    );
  }
}