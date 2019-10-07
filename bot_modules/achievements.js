let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let data = {};
let config = defaultConfigs;
let pgclient = null;
const GOVERNING_ROOM = "trivia"
exports.GOVERNING_ROOM = GOVERNING_ROOM

//Queries
const INSERT_USER_SQL = "INSERT INTO users (username, display_name) VALUES ($1, $2);";
const INSERT_ALT_SQL = "INSERT INTO alts (username, main_id) VALUES ($1, (SELECT id FROM users WHERE username = $2 FETCH FIRST 1 ROWS ONLY));";
const GET_USER_SQL = "SELECT users.id, users.username, users.display_name FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 FETCH FIRST 1 ROWS ONLY;";
const INSERT_ACHIEVEMENT_SQL = "INSERT INTO achievement_list VALUES (DEFAULT, $1, $2, $3, $4);";
const DELETE_ACHIEVEMENT_SQL = "DELETE FROM achievement_list WHERE name_id = $1;";
const GET_ALL_ACHIEVEMENTS_SQL = "SELECT * FROM achievement_list;";
const GET_ACHIEVEMENT_BY_NAME_SQL = "SELECT * FROM achievement_list WHERE name_id = $1;";
const INSERT_PLAYER_ACHIEVEMENT_SQL = "INSERT INTO player_achievements VALUES ($1, $2, CURRENT_TIMESTAMP);";
const DELETE_PLAYER_ACHIEVEMENT_SQL = "DELETE FROM player_achievements WHERE player_id = $1 AND achievement_id = $2;";
const DELETE_ACHIEVEMENT_BY_NAME_SQL = "DELETE FROM player_achievements WHERE achievement_id = (SELECT id FROM achievement_list WHERE name_id = $1 FETCH FIRST 1 ROWS ONLY);";
const GET_PLAYER_ACHIEVEMENTS_SQL = "SELECT achievement_list.name from player_achievements INNER JOIN achievement_list ON player_achievements.achievement_id = achievement_list.id WHERE player_achievements.player_id = $1;";

exports.onLoad = function(module, loadData, oldData){
	self = module;
	refreshDependencies();
	if(oldData) data = oldData;
	if(loadData){
		data = {};
	}
};
exports.onUnload = function(){

};
let refreshDependencies = function(){
	pgclient = getModuleForDependency("pgclient", "achievements")
};
exports.refreshDependencies = refreshDependencies;
exports.onConnect = function(){

};
exports.getData = function(){
	return data;
}
exports.getConfig = function(){
	return config;
}
exports.setConfig = function(newConfig){
	config = newConfig;
}


let commands = {
	ach: "achievement",
	achievement: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0){
			let command = args[0].toLowerCase();
			if(achievementCommands[command]){
				achievementCommands[command](message, args.slice(1), user, rank, room, commandRank, commandRoom)
				return;
			}
		}
		room.broadcast(user, "Usage: ~achievement [add/remove/award/unaward/list/check]", rank);
	}
};

self.commands = commands;
exports.commands = commands;

let achievementCommands = {
	add: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, config.achievementManageRank)){
			if(args.length>2){
				let name = args[0];
				let id = toId(name);
				let desc = args[1];
				let points = args[2] && /^[\d]+$/.test(args[2]) ? parseInt(args[2]) : -1;
				if(name.length>40){
					room.broadcast(user, "The name can be 40 characters long at most.", rank);
				}else if(!id){
					room.broadcast(user, "The name needs at least one alphanumeric character.", rank);
				}else if(points==-1){
					room.broadcast(user, "The value must be a non-negative integer.", rank);
				}else{
					pgclient.runSql(INSERT_ACHIEVEMENT_SQL, [name, id, desc, points], (row)=>{
					},()=>{
						room.broadcast(user, "Successfully created the achievement.", rank);
					},(err)=>{
						error(err);
						room.broadcast(user, "Something went wrong when adding the achievement. It may already exist.", rank);
					});
				}
			}else{
				room.broadcast(user, "Please specify a name, a description, and a points value.", rank);
			}
		}else{
			room.broadcast(user, "Your rank is not high enough to manage achievements.", rank);
		}
	},
	remove: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, config.achievementManageRank)){
			if(args.length>0){
				let id = toId(args[0]);
				if(!id){
					room.broadcast(user, "The name needs at least one alphanumeric character.", rank);
				}else{
					pgclient.runSql(DELETE_ACHIEVEMENT_BY_NAME_SQL, [id], ()=>{}, ()=>{
						pgclient.runSql(DELETE_ACHIEVEMENT_SQL, [id], (row)=>{
						},(res)=>{
							if(res.rowCount===0){
								room.broadcast(user, "That achievement doesn't exist.", rank);
							}else{
								room.broadcast(user, "Successfully removed the achievement.", rank);
							}
						},(err)=>{
							error(err);
							room.broadcast(user, "Something went wrong when deleting the achievement.", rank);
						});
					}, (err)=>{
						error(err);
						room.broadcast(user, "Something went wrong when deleting the achievement.", rank);
					});
				}
			}else{
				room.broadcast(user, "Please specify the achievement name.", rank);
			}
		}else{
			room.broadcast(user, "Your rank is not high enough to manage achievements.", rank);
		}
	},
	list: function(message, args, user, rank, room, commandRank, commandRoom){
		let output = "ACHIEVEMENT LIST\n################\n\n";
		pgclient.runSql(GET_ALL_ACHIEVEMENTS_SQL, [], (row)=>{
			//output+="Name: " + row.name + ", Points: " + row.value + ", Description: \n" + row.description + "\n\n"; //This can be used if points ever matter
			output+="Name: " + row.name + ", Description: \n" + row.description + "\n\n";
		}, (res)=>{
			uploadText(output, (address)=>{
				room.broadcast(user, "Here are the achievements: " + address, rank);
			}, (error)=>{
				room.broadcast(user, "There was an error while saving the file.", rank);
			});
		}, (err)=>{
			room.broadcast(user, "Something went wrong when getting the achievement list.", rank);
		});
	},
	award: function(message, args, user, rank, room, commandRank, commandRoom){
		info(args);
		if(!AuthManager.rankgeq(commandRank, config.achievementManageRank)){
			room.broadcast(user, "Your rank is not high enough to manage achievements.", rank);
		}else if(args.length<2){
			room.broadcast(user, "You must specify the user and the achievement.", rank);
		}else{
			awardAchievement(args[0], args[1], (p,a)=>{room.broadcast(user, p + " has earned the achievement '" + a + "'!")}, (result)=>{room.broadcast(user, result)});
		}
	},
	unaward: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, config.achievementManageRank)){
			room.broadcast(user, "Your rank is not high enough to manage achievements.", rank);
		}else if(args.length<2){
			room.broadcast(user, "You must specify the user and the achievement.", rank);
		}else{
			let username = args[0];
			let achievement = toId(args[1]);
			pgclient.getId(username, false, (user)=>{
				if(!user){
					room.broadcast(user, "That user does not exist.", rank);
					return;
				}
				let achievementid;
				pgclient.runSql(GET_ACHIEVEMENT_BY_NAME_SQL, [achievement], (row)=>{
					achievementid = row.id;
				}, (res)=>{
					if(!achievementid){
						room.broadcast(user, "There's no achievement with that name.", rank);
					}else{
						pgclient.runSql(DELETE_PLAYER_ACHIEVEMENT_SQL, [user.id, achievementid], null, (res)=>{
							if(res.rowCount===0){
								room.broadcast(user, user.display_name + " doesn't have that achievement.", rank);
							}else{
								room.broadcast(user, "Successfully removed the achievement.", rank);
							}
						}, (err)=>{
							error(err);
							room.broadcast(user, "Something went wrong removing the achievement.", rank);
						})
					}
				}, (err)=>{
					error(err);
					room.broadcast(user, "Something went wrong getting the achievement.", rank);
				});
			}, (err)=>{
				error(err);
				room.broadcast(user, "Something went wrong getting the user.", rank);
			});
		}
	},
	check: function(message, args, user, rank, room, commandRank, commandRoom){
		let username = args[0] || user.name;
		pgclient.getId(username, false, (res)=>{
			if(!res){
				room.broadcast(user, "The user " + username + " doesn't exist.", rank);
			}else{
				let output = res.display_name + "'s achievements:\n";
				pgclient.runSql(GET_PLAYER_ACHIEVEMENTS_SQL, [res.id], (row)=>{
					output += row.name + "\n";
				},(res2)=>{
					uploadText(output, (address)=>{
						room.broadcast(user, "Here are " + res.display_name + "'s achievements: " + address, rank);
					}, (error)=>{
						room.broadcast(user, "There was an error while saving the file.", rank);
					});
				},(err)=>{
					error(err);
					room.broadcast(user, "There was a problem getting " + res.display_name + "'s achievements.", rank);
				});
			}
		}, (err)=>{
			error(err);
			room.broadcast(user, "There was a problem when getting the user.", rank);
		});

	},

};

let awardAchievement = function(username, achievement, onSuccess, onFailure){
	if(!onSuccess){
		onSuccess = (p, a)=>{info(p + " earned achievement " + a)};
	}
	if(!onFailure){
		onFailure = (message)=>{error(message)};
	}
	achievement = toId(achievement);
	pgclient.getId(username, true, (user)=>{
		let achievementid;
		pgclient.runSql(GET_ACHIEVEMENT_BY_NAME_SQL, [achievement], (row)=>{
			achievementid = row.id;
			username = row.name
		}, (res)=>{
			if(!achievementid){
				onFailure("Tried to give " + username + " the achievement " + achievement + ", but it doesn't exist.");
			}else{
				pgclient.runSql(INSERT_PLAYER_ACHIEVEMENT_SQL, [user.id, achievementid], null, (res)=>{
					onSuccess(user.display_name, username);
				}, (err)=>{
					error(err);
					onFailure("Tried to give " + username + " the achievement " + achievement + ", but something went wrong. Maybe they already had it.");
				})
			}
		}, (err)=>{
			error(err);
			onFailure("Tried to give " + username + " the achievement " + achievement + ", but something went wrong getting the achievement.");
		});
	}, (err)=>{
		error(err);
		onFailure("Tried to give " + username + " the achievement " + achievement + ", but something went wrong getting the user.");
	});
}
exports.awardAchievement = awardAchievement;

let defaultConfigs = {
	achievementManageRank: "@"
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	achievementManageRank: "rank"
};

exports.configTypes = configTypes;
