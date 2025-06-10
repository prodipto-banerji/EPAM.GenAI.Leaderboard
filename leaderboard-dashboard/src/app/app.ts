import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LeaderboardComponent } from './leaderboard/leaderboard';

@Component({
  selector: 'app-root',
  imports: [LeaderboardComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  standalone : true,
})
export class App {
  protected title = 'leaderboard-dashboard';
}
