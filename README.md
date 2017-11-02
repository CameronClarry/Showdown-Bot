# Showdown-Bot
A lightweight, modular Pokemon Showdown bot.
Very much a WIP.
More information will be displayed here whenever I get around to it or if someone asks for it.

Now, for some commands. As a general rule, curly square brackets ([]) indicate something that must be filled in when giving the command. Curly braces ({}) indicate an optional parameter. In general, if you wish to broadcast a command in a room, you must be at least voiced in that room.

## Trivia Tracker commands
These commands deal with the Trivia Tracker (tt) module.

`~tt newgame, {room}`

`~tt endgame, {room}`

These commands start and end, respectively, a game of Trivia Tracker in the room that they are used in, or in {room} if it is specified.

The following commands are for the Trivia Tracker leaderboard.


Command|Usage|Required Rank
-|-|:-:
`~ttl check, {user}, {leaderboard}`|This command checks your score on the leaderboard, or the score of {user} if specified. The leaderboard defaults to the main one, but may be specified.|None
`ttl list, {number}, {leaderboard}`|This lists the top five users on the leaderboard. The number of users to list and leaderboard to list from can be specified.|None
`~ttl summary, {leaderboard}`|Gets a variety of statistics on your ranking in the main leaderboard, or any other leaderboard that is specified|None
`~ttl set, [user], [points], {leaderboard}`|Sets the given user's score to the given number (must be positive). Defaults to acting on the main leaderboard, but can be specified.|@
`~ttl add, [user], [points]`|This adds (or subtracts) the given number of points to (or from) all of the given user's scores. This affects all leaderboards.|@
`ttl remove, [user]`|Removes the specified user from all leaderboards.|@
`~ttl reset`|This resets the main leaderboard. Use with caution.|#

These commands are used to manage the temporary leaderboards (events).

Command|Usage|Required Rank
-|-|:-:
`~event list`|This will list all of the current events.|None
`~event add, [name]`|This will add an event to the event list, with the specified name.|#
`~event remove, [name]`|This removes the given event.|#
`~event info, [name]`|Gives a variety of information on the event specified such as when it was made, who made it, etc.|None
`~event enable, [name]`|Enables the given event. Scores will be updated in it from regular Trivia Tracker play and ~ttl add.|#
`~event disable, [name]`|Disables the given event. Scores in it will no longer be updated from regular Trivia Tracker play and ~ttl add.|#
