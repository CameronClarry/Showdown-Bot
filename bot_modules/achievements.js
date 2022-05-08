//Queries
const INSERT_ACHIEVEMENT_SQL = "INSERT INTO achievement_list VALUES (DEFAULT, $1, $2, $3, $4);";
const DELETE_ACHIEVEMENT_SQL = "DELETE FROM achievement_list WHERE name_id = $1;";
const GET_ALL_ACHIEVEMENTS_SQL = "SELECT * FROM achievement_list;";
const GET_ACHIEVEMENT_BY_NAME_SQL = "SELECT * FROM achievement_list WHERE name_id = $1;";
const INSERT_PLAYER_ACHIEVEMENT_SQL = "INSERT INTO player_achievements VALUES ($1, $2, CURRENT_TIMESTAMP);";
const DELETE_PLAYER_ACHIEVEMENT_SQL = "DELETE FROM player_achievements WHERE player_id = $1 AND achievement_id = $2;";
const DELETE_ACHIEVEMENT_BY_NAME_SQL = "DELETE FROM player_achievements WHERE achievement_id = (SELECT id FROM achievement_list WHERE name_id = $1 FETCH FIRST 1 ROWS ONLY);";
const GET_PLAYER_ACHIEVEMENTS_SQL = "SELECT achievement_list.name, achievement_list.value from player_achievements INNER JOIN achievement_list ON player_achievements.achievement_id = achievement_list.id WHERE player_achievements.player_id = $1;";
const GET_ACHIEVEMENT_LB_SQL = "WITH scores AS ( SELECT player_id, COUNT(*) AS achievements, SUM(value) AS points FROM player_achievements AS pa INNER JOIN achievement_list AS al ON pa.achievement_id = al.id GROUP BY player_id ) SELECT display_name, achievements, points FROM scores INNER JOIN users ON users.id = scores.player_id ORDER BY points DESC LIMIT _NUMBER_;"

let commands = {
	ach: "achievement",
	achievement: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0){
			let command = args[0].toLowerCase();
			let commandFunc = achievementCommands[command]
			if(commandFunc){
				commandFunc = typeof commandFunc == "string" ? achievementCommands[commandFunc] : commandFunc;
				commandFunc.call(this, message, args.slice(1), user, rank, room, commandRank, commandRoom)
				return;
			}
		}
		room.broadcast(user, "Usage: ~achievement [add/remove/award/unaward/list/check]", rank);
	}
};

let achievementCommands = {
	add: function(message, args, user, rank, room, commandRank, commandRoom){
		let name = args[0];
		let id = toId(name);
		let desc = args[1];
		let points = args[2] && /^[\d]+$/.test(args[2]) ? parseInt(args[2]) : -1;
		if(!AuthManager.rankgeq(commandRank, this.config.achievementManageRank.value)){
			room.broadcast(user, "Your rank is not high enough to manage achievements.", rank);
		}else if(args.length < 3){
			room.broadcast(user, "Please specify a name, a description, and a points value.", rank);
		}else if(name.length > 40){
			room.broadcast(user, "The name can be 40 characters long at most.", rank);
		}else if(!id){
			room.broadcast(user, "The name needs at least one alphanumeric character.", rank);
		}else if(points<0){
			room.broadcast(user, "The value must be a non-negative integer.", rank);
		}else{
			this.pgclient.runSql(INSERT_ACHIEVEMENT_SQL, [name, id, desc, points], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}

				room.broadcast(user, "Successfully created the achievement.", rank);
			});
		}
	},
	remove: function(message, args, user, rank, room, commandRank, commandRoom){
		let id = toId(args[0]);
		if(!AuthManager.rankgeq(commandRank, this.config.achievementManageRank.value)){
			room.broadcast(user, "Your rank is not high enough to manage achievements.", rank);
		}else if(!id){
			room.broadcast(user, "The name needs at least one alphanumeric character.", rank);
		}else{
			this.pgclient.runSql(DELETE_ACHIEVEMENT_BY_NAME_SQL, [id], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}

				this.pgclient.runSql(DELETE_ACHIEVEMENT_SQL, [id], (err, res2)=>{
					if(err){
						error(err);
						room.broadcast(user, `Error: ${err}`);
						return;
					}

					if(res2.rowCount===0){
						room.broadcast(user, "That achievement doesn't exist.", rank);
					}else{
						room.broadcast(user, "Successfully removed the achievement.", rank);
					}
				});
			});
		}
	},
	list: function(message, args, user, rank, room, commandRank, commandRoom){
		this.pgclient.runSql(GET_ALL_ACHIEVEMENTS_SQL, [], (err, res)=>{
			if(err){
				error(JSON.stringify(err));
				room.broadcast(user, `Error: ${err}`);
				return;
			}

			let output=`<div style="max-height:200px;overflow-y:scroll"><table style="color: black; background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916" border=1><tr><th>Achievement</th><th>Description</th><th>Points</th></tr>${res.rows.map((row)=>{return `<tr><td>${row.name}</td><td>${row.description}</td><td>${row.value}</td></tr>`;}).join('')}</table></div>`;
			if(AuthManager.rankgeq(rank, '+') && room && room.id){
				info(room.id);
				room.send(`/addhtmlbox ${output}`);
			}else{
				send(`trivia|/pminfobox ${user.id}, ${output}`);
			}
		});
	},
	award: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.achievementManageRank.value)){
			room.broadcast(user, "Your rank is not high enough to manage achievements.", rank);
		}else if(args.length < 2){
			room.broadcast(user, "You must specify the user and the achievement.", rank);
		}else{
			this.awardAchievement(args[0], args[1], (err, username, achievement)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}

				room.broadcast(user, `${username} has earned the achievement '${achievement}'!`);
			});
		}
	},
	unaward: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.achievementManageRank.value)){
			room.broadcast(user, "Your rank is not high enough to manage achievements.", rank);
		}else if(args.length < 2){
			room.broadcast(user, "You must specify the user and the achievement.", rank);
		}else{
			let username = args[0];
			let achievement = toId(args[1]);
			this.pgclient.getUser(username, false, (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}

				if(!res){
					room.broadcast(user, "That user does not exist.", rank);
					return;
				}
				this.pgclient.runSql(GET_ACHIEVEMENT_BY_NAME_SQL, [achievement], (err, res2)=>{
					if(err){
						error(err);
						room.broadcast(user, `Error: ${err}`);
						return;
					}

					if(!res2.rowCount){
						room.broadcast(user, "There's no achievement with that name.", rank);
						return;
					}
					let achievementId = res2.rows[0].id;
					this.pgclient.runSql(DELETE_PLAYER_ACHIEVEMENT_SQL, [res.id, achievementId], (err, res3)=>{
						if(err){
							error(err);
							room.broadcast(user, `Error: ${err}`);
							return;
						}

						if(res3.rowCount===0){
							room.broadcast(user, `${res.display_name} doesn't have that achievement.`, rank);
						}else{
							room.broadcast(user, "Successfully removed the achievement.", rank);
						}
					});
				});
			});
		}
	},
	check: function(message, args, user, rank, room, commandRank, commandRoom){
		let username = args[0] || user.name;
		this.pgclient.getUser(username, false, (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, `Error: ${err}`);
				return;
			}

			if(!res){
				room.broadcast(user, `The user ${username} doesn't exist.`, rank);
			}else{
				this.pgclient.runSql(GET_PLAYER_ACHIEVEMENTS_SQL, [res.id], (err, res2)=>{
					if(err){
						error(err);
						room.broadcast(user, `Error: ${err}`);
						return;
					}
					let pointArray = res2.rows.map((row)=>{return row.value;});
					let totalScore = pointArray.reduce((a,b)=>{return a+b;}, 0);

					let output=`<div style="max-height:200px;overflow-y:scroll"><table style="color: black; background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916" border=1><tr><th colspan=2>${res.display_name}'s Achievements</th></tr><tr><th>Achievement</th><th>Points</th></tr>${res2.rows.map((row)=>{return `<tr><td>${row.name}</td><td>${row.value}</td></tr>`;}).join('')}<tr><th>Total</th><th>${totalScore}</th></tr></table></div>`;
					if(AuthManager.rankgeq(rank, '+') && room && room.id){
						info(room.id);
						room.send(`/addhtmlbox ${output}`);
					}else{
						send(`trivia|/pminfobox ${user.id}, ${output}`);
					}
				});
			}
		});
	},
	lb: "leaderboard",
	leaderboard: function(message, args, user, rank, room, commandRank, commandRoom){
		info(args[0]);
		let number = /^[\d]+$/.test(args[0]) ? parseInt(args[0], 10) : 10;
		this.pgclient.runSql(GET_ACHIEVEMENT_LB_SQL.replace("_NUMBER_",number), [], (err, res)=>{
			if(err){
				error(JSON.stringify(err));
				room.broadcast(user, `Error: ${err}`);
				return;
			}

			let output=`<div style="max-height:200px;overflow-y:scroll"><table style="color: black; background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916" border=1><tr><th>User</th><th>Achievements</th><th>Score</th></tr>${res.rows.map((row)=>{return `<tr><td>${row.display_name}</td><td>${row.achievements}</td><td>${row.points}</td></tr>`;}).join('')}</table></div>`;
			if(AuthManager.rankgeq(rank, '+') && room && room.id){
				info(room.id);
				room.send(`/addhtmlbox ${output}`);
			}else{
				send(`trivia|/pminfobox ${user.id}, ${output}`);
			}
		});
	}
};

class Achievements extends BaseModule{
	constructor(){
		super();
		this.room = Achievements.room;
		this.config = {
			achievementManageRank: new ConfigRank('@')
		};
		this.commands = commands;
		this.dependencies = ['pgclient'];
	}

	awardAchievement(username, achievement, callback){
		let achievementId = toId(achievement);
		this.pgclient.getUser(username, true, (err, user)=>{
			this.pgclient.runSql(GET_ACHIEVEMENT_BY_NAME_SQL, [achievementId], (err, res)=>{
				if(err){
					callback(err);
					return;
				}

				let achEntry = res.rows[0];
				if(!achEntry){
					callback(`Tried to give ${username} the achievement ${achievementId}, but it doesn't exist.`);
				}else{
					this.pgclient.runSql(INSERT_PLAYER_ACHIEVEMENT_SQL, [user.id, achEntry.id], (err, res)=>{
						if(err){
							callback(err);
							return;
						}

						callback(err, user.display_name, achEntry.name);
					});
				}
			});
		});
	};

	// Achievement crap
	// This is called when a leaderboard is reset.
	// leaderboard is the string id of the leaderboard being reset.
	// scores is an array of {display_name, points}, sorted descending by points.
	// There are achievements for getting first, getting top 5, and getting 6th
	achievementsOnReset(leaderboard, scores){
		let triviaRoom = RoomManager.getRoom('trivia');
		let callback = (err, username, achievement)=>{
			if(err){
				error(err);
				return;
			}

			if(triviaRoom) triviaRoom.send(`${username} has earned the achievement '${achievement}'!`);
		}
		if(scores.length > 0 && leaderboard === 'main'){ // Awarding achievements
			let firstPlace = scores.filter((e)=>{return e.points === scores[0].points});
			for(let i=0;i<firstPlace.length;i++){
				this.awardAchievement(firstPlace[i].display_name, "Hatmor", callback);
			}
			let num = firstPlace.length;
			while(num<5 && num < scores.length){ // Using black magic to find all players in the top 5
				num += scores.filter((e)=>{return e.points === scores[num].points}).length;
			}
			let top5 = scores.slice(firstPlace.length, num);
			for(let i=0;i<top5.length;i++){
				this.awardAchievement(top5[i].display_name, "Elite", callback);
			}
			let message = `Congratulations to ${prettyList(firstPlace.map((e)=>{return e.display_name}))} for getting first`;
			if(top5.length){
				message += `, and to ${prettyList(top5.map((e)=>{return e.display_name}))} for being in the top five!`;
			}else{
				message += "!";
			}
			if(!triviaRoom) return;
			triviaRoom.send(message);
			if(num === 5 && scores.length > 5){
				let consolation = scores.filter((e)=>{return e.points === scores[5].points});
				for(let i=0;i<consolation.length;i++){
					this.awardAchievement(consolation[i].display_name, "Consolation Prize", callback);
				}
			}
		}
	}

	// TODO this needs to be called from pgclient when updating scores
	achievementsOnScoreUpdate(username, leaderboard, oldScore, newScore){
		let triviaRoom = RoomManager.getRoom(this.room);
		let callback = (err, username, achievement)=>{
			if(err){
				error(err);
				return;
			}

			if(triviaRoom) triviaRoom.send(`${username} has earned the achievement '${achievement}'!`);
		}
		if(leaderboard === 'main'){
			if(oldScore < 250 && newScore >= 250){
				this.awardAchievement(username, 'Super', callback);
			}
			if(oldScore < 500 && newScore >= 500){
				this.awardAchievement(username, 'Mega', callback);
			}
			if(oldScore < 750 && newScore >= 750){
				this.awardAchievement(username, 'Ultra', callback);
			}
			if(oldScore < 1000 && newScore >= 1000){
				this.awardAchievement(username, 'Hyper', callback);
			}
		}
	};
}

Achievements.room = 'trivia';

exports.Module = Achievements;
