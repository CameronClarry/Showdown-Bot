//Queries
const INSERT_ACHIEVEMENT_SQL = "INSERT INTO achievement_list VALUES (DEFAULT, $1, $2, $3, $4);";
const DELETE_ACHIEVEMENT_SQL = "DELETE FROM achievement_list WHERE name_id = $1;";
const GET_ALL_ACHIEVEMENTS_SQL = "SELECT * FROM achievement_list;";
const GET_ACHIEVEMENT_BY_NAME_SQL = "SELECT * FROM achievement_list WHERE name_id = $1;";
const INSERT_PLAYER_ACHIEVEMENT_SQL = "INSERT INTO player_achievements VALUES ($1, $2, CURRENT_TIMESTAMP);";
const DELETE_PLAYER_ACHIEVEMENT_SQL = "DELETE FROM player_achievements WHERE player_id = $1 AND achievement_id = $2;";
const DELETE_ACHIEVEMENT_BY_NAME_SQL = "DELETE FROM player_achievements WHERE achievement_id = (SELECT id FROM achievement_list WHERE name_id = $1 FETCH FIRST 1 ROWS ONLY);";
const GET_PLAYER_ACHIEVEMENTS_SQL = "SELECT achievement_list.name from player_achievements INNER JOIN achievement_list ON player_achievements.achievement_id = achievement_list.id WHERE player_achievements.player_id = $1;";

let commands = {
	ach: "achievement",
	achievement: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0){
			let command = args[0].toLowerCase();
			if(achievementCommands[command]){
				achievementCommands[command].call(this, message, args.slice(1), user, rank, room, commandRank, commandRoom)
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
			info('in callback');
			if(err){
				error(JSON.stringify(err));
				room.broadcast(user, `Error: ${err}`);
				return;
			}

			let output=`ACHIEVEMENT LIST\n################\n\n${res.rows.map((row)=>{return `Name: ${row.name}, Description: \n${row.description}`;}).join('\n\n')}`;
			uploadText(output, (address)=>{
				room.broadcast(user, `Here are the achievements: ${address}`, rank);
			}, (error)=>{
				room.broadcast(user, "There was an error while saving the file.", rank);
			});
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

					let output = `${res.display_name}'s achievements:\n${res2.rows.map((row)=>{return row.name;}).join('\n')}`;
					uploadText(output, (address)=>{
						room.broadcast(user, `Here are ${res.display_name}'s achievements: ${address}`, rank);
					}, (error)=>{
						room.broadcast(user, "There was an error while saving the file.", rank);
					});
				});
			}
		});
	},
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

exports.Module = Achievements;
