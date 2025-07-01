// Player.js - JavaScript model equivalent to Player.cs
class Player {
    constructor(name, email, score, timetaken, displaytime, date, location) {
        this.name = name;
        this.email = email;
        this.score = score;
        this.timetaken = timetaken; 
        this.displaytime = displaytime;
        this.location = location;
    }
}

module.exports = Player;
