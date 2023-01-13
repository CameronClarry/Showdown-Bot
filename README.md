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
`~ttl list, {number}, {leaderboard}`|This lists the top five users on the leaderboard. The number of users to list and leaderboard to list from can be specified.|None
`~ttl summary, {leaderboard}`|Gets a variety of statistics on your ranking in the main leaderboard, or any other leaderboard that is specified|None
`~ttl stats, {leaderboard}`|Gets a variety of statistics the main leaderboard, or any other leaderboard that is specified|None
`~ttl set, [user], [points], {leaderboard}`|Sets the given user's score to the given number (must be positive). Defaults to acting on the main leaderboard, but can be specified.|@
`~ttl add, [user], [points]`|This adds (or subtracts) the given number of points to (or from) the given user's scores. This affects all enabled leaderboards.|@
`~ttl addto, [user], [points], [leaderboard]`|This adds (or subtracts) the given number of points to (or from) the given user's score. This only affects the given leaderboard, and works even if it is disabled.|@
`~ttl remove, [user]`|Removes the specified user from all leaderboards.|@
`~ttl reset`|This resets the main leaderboard. Use with caution.|#

These commands are used to manage the temporary leaderboards (events). Note: all these commands can be accessed with either `~event` or `~minigame`.

Command|Usage|Required Rank
-|-|:-:
`~event list`|This will list all of the current events.|None
`~event add, [name]`|This will add an event to the event list, with the specified name.|@
`~event remove, [name]`|This removes the given event.|@
`~event info, [name]`|Gives a variety of information on the event specified such as when it was made, who made it, etc.|None
`~event enable, [name]`|Enables the given event. Scores will be updated in it from regular Trivia Tracker play and ~ttl add.|@
`~event disable, [name]`|Disables the given event. Scores in it will no longer be updated from regular Trivia Tracker play and ~ttl add.|@

Regular Trivia Tracker commands:

Command|Usage|Required Rank
-|-|:-:
`~yes [user], {afk}`|This command should be used when [user] gets your question correct. You must be the one with BP to use this. For auth, if the `afk` is included, the previous points that were awarded will be undone.|None
`~no [number]`|This undoes that last [number] of turns.|+
`~bp [user]`|This gives the specified user BP, but does not change any points.|+
`~bpopen`|Opens BP, allowing it to be claimed. Can only be used by the person with BP, or someone with the required rank. If an auth opens it, only an auth can close it.|+
`~bpclose`|Closes BP. Can only be used by the user that opened it, or someone with the required rank.|+
`~bplock`|Locks BP, preventing it from being opened and preventing users from being ~yessed. Can only be used by someone with the required rank.|+
`~bpunlock`|Unlock BP, allowing BP to used as normal again. Can only be used by someone with the required rank.|+

There are also a number of aliases for the `~yes` command: yea, yup, sure, yee, yep, yeah, hellyeah, ofcourse, butofcourse, go, oui, si, right, aye, ya, ye, correct, ja, indeed, and damnright.

Blacklist commands:

Command|Usage|Required Rank
-|-|:-:
`~ttblacklist add, [user], {duration}, {reason}` | Adds the given user to the TT blacklist. The reason can be specified, as can the duration (in minutes). If no duration is given, it is permanent. This will also make a modnote recording it. | @
`~ttblacklist remove, [user]` | Removes the given user from the TT blacklist. | @
`~ttblacklist check [user]` | Checks if the given user is on the TT blacklist. | @
`~ttmute` [user], {reason} | Adds the given user to the TT blacklist for 7 minutes. | %
`~tthourmute` [user], {reason} | Adds the given user to the TT blacklist for 60 minutes. | %
`~ttunmute` [user] | Removes the given user from the TT blacklist if their duration is at most 60 minutes. | %

Achievement commands:

Command|Usage|Required Rank
-|-|:-:
`~ach add, [name], [description], [points]`|Adds the given achievement to the achievement list. The name must be at most 40 characters long, and must contain at least one alphanumeric character.|@
`~ach remove, [name]`|Removes the given achievement from the achievement list.|@
`~ach list`|Gives a list of all current achievements, their descriptions, and point values.|None
`~ach check, {name}`|Returns a list of all your achievements, or those of the user specified.|None
`~ach award, [user], [achievement]`|Attempts to award the specified achievement.|@
`~ach unaward, [user], [achievement]`|Attempts to revoke the specified achievement.|@

Minigame helper commands:
See https://trivia.cclarry.ca/minigames/

Misc commands:

Command|Usage|Required Rank
-|-|:-:
`~nominate {user}, [question]`|Nominates the last question from `{user}` for best question of the cycle. If you are roomauth, you can specify the text of the question that is nominated and it can be used at any time.|None
`~alts {user}`|Displays your alts, or the alts of `{user}` if you have the required rank.|%
`~alt [user]`|Links your account with `[user]`. This command must be used from both accounts to complete the link.|None
`~removealt [user]`|Removes the specified account from your linked accounts. It cannot be your main account.|None
`~main [name]`|Changes your main account. The name given must match one of your alts in alphanumeric characters (eg. StRuChNi! is acceptable for Struchni). This is the name that you will be referred to as in all leaderboard listings.|None
`~custbpadd [user], [message]`|Sets a custom message for when a user receives BP.|@
`~custbpremove [user]`|Removes a user's custom BP message.|@
`~timer [seconds], {message}, {room}`|This will set a timer to go off in [seconds] seconds. The message can be specified, otherwise a default will be used. Note that the message will always use `/wall`. The room can also be specified, defaulting to the room the message is used in.|+
`~ttbtimer [min seconds], [max seconds], {message}, {room}`|This will set a timer to go off in between [min seconds] and [max seconds] seconds. The message can be specified, otherwise a default will be used. Note that the message will always use `/wall`. The room can also be specified, defaulting to the room the message is used in.|+
`~timer end, {room}`|This will clear the timer in the given room. If no room is given, it defaults to the room that the command is used in.|+
`~addfact [fact]`|Adds the given fact to the database.|+
`~removefact [fact]`|Removes the given fact.|+
`~factlist`|This will PM you a pastebin of all facts in the database.|+
`~fact`|Displays a random fact.|+
`~factsearch [text]`|Displays a random fact containing the given text.|+
`~next`|Shows when the next Trivia official begins. Identical to `~nextofficial`.|None
`~nextcycle`|Shows when the next Trivia Tracker cycle begins.|None
`~help`|Gives the list of commands.|None
`~rules`|Links to the rules doc.|None
`~legacyrules`|Links to the old rules PDF.|None
`~intro`|Links to the intro doc for new users.|None
`~plug`|Plugs the plug (https://plug.dj/trivia/)|None
