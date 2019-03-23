# Showdown-Bot: minigamehelper module
This module offers various commands to make hosting minigames easier.

As a general rule, curly square brackets (`[]`) indicate something that must be filled in when giving the command. Curly braces (`{}`) indicate an optional parameter. In general, if you wish to broadcast a command in a room, you must be at least voiced in that room.

## General minigame commands
These commands can apply to many different minigames.

Command|Usage|Default Required Rank
-|-|:-:
`~pladd [user1], {user2, {user 3, ...}}` | This command will add all of the given users to the player list. | +
`~plremove [user1], {user2, {user 3, ...}}` | This command will remove all of the given users from the player list. | +
`~plclear` | Removes all players from the player list. | +
`~plmax [N/off]` | If a number N larger than 0 is given, turns on autojoin and lets up to N players join the game by typing '/me in'. If 0 or anything else is given, turns off autojoin. Remember to always turn off autojoin once the game has started. | +
`~pllist {html}` | Gives the current player list. The names are italicized to prevent highlighting. If the 'html' option is given, displays the player list as an html table. | +
`~plshuffle` | Gives the current player list, in a random order. | +

## Titanomachy commands

These commands are mainly used for the Titanomachy minigame.

Command|Usage|Default Required Rank
-|-|:-:
`~tar [user1], {user2, {user 3, ...}}` | This command will add all of the given users to the reg player list. | +
`~taa [user1], {user2, {user 3, ...}}` | This command will add all of the given users to the auth player list. | +
`~tr [user1], {user2, {user 3, ...}}` | This command will remove all of the given users from both the reg player list and the auth player list. | +
`~titanclear` | Removes all players from both the reg player list and the auth player list. | +
`~titanlist {html}` | Sends two chat messages, one listing the reg players and one listing the auth players. The names are italicized to prevent highlighting. If the 'html' option is given, displays the player lists as an html table. | +
