import { TestBed } from '@angular/core/testing';

import { Leaderboardservicemock } from './leaderboardservicemock';

describe('Leaderboardservicemock', () => {
  let service: Leaderboardservicemock;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Leaderboardservicemock);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
