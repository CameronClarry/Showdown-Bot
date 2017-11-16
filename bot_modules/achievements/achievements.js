let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let chat = null;
let auth = null;
let rooms = null;
let pgclient = null;
let request = require("request");

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

exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){
		self.data = {};
	}
	self.chathooks = {
		chathook: function(m){
			if(m && !m.isInit){
				let text = m.message;
				if(text[0]==="~"){
					let command = text.split(" ")[0].trim().toLowerCase().substr(1);
					let argText = text.substring(command.length+2, text.length);
					let chatArgs = argText === "" ? [] : argText.split(",");
					for(let i = 0;i<chatArgs.length;i++){
						chatArgs[i] = chatArgs[i].trim();
					}
					if(commands[command]&&auth&&auth.js&&chat&&chat.js&&rooms&&rooms.js){
						let rank = auth.js.getEffectiveRoomRank(m, "trivia");
						let commandToRun = commands[command];
						if(typeof commandToRun === "string"){
							commandToRun = commands[commandToRun];
						}
						commandToRun(m, chatArgs, rank);
					}
				}
			}
		}
	};
};
exports.onUnload = function(){

};
exports.refreshDependencies = function(){
	chat = getModuleForDependency("chat", "achievements");
	auth = getModuleForDependency("auth", "achievements");
	rooms = getModuleForDependency("rooms", "achievements");
	pgclient = getModuleForDependency("pgclient", "achievements")
};
exports.onConnect = function(){

};


let commands = {
	ach: "achievement",
	achievement: function(message, args, rank){
		if(args.length>0){
			let command = args[0].toLowerCase();
			if(achievementCommands[command]){
				achievementCommands[command](message, args.slice(1), rank);
				return;
			}
		}
		chat.js.reply(message, "Usage: ~achievement [add/remove/award/unaward/list/check]");
	}
};

let achievementCommands = {
	add: function(message, args, rank){
		if(auth.js.rankgeq(rank, self.config.achievementManageRank)){
			if(args.length>2){
				let name = args[0];
				let id = toId(name);
				let desc = args[1];
				let points = args[2] && /^[\d]+$/.test(args[2]) ? parseInt(args[2]) : -1;
				if(name.length>40){
					chat.js.reply(message, "The name can be 40 characters long at most.");
				}else if(!id){
					chat.js.reply(message, "The name needs at least one alphanumeric character.");
				}else if(points==-1){
					chat.js.reply(message, "The value must be a non-negative integer.")
				}else{
					pgclient.js.runSql(INSERT_ACHIEVEMENT_SQL, [name, id, desc, points], (row)=>{
					},()=>{
						chat.js.reply(message, "Successfully created the achievement.");
					},(err)=>{
						error(err);
						chat.js.reply(message, "Something went wrong when adding the achievement. It may already exist.");
					});
				}
			}else{
				chat.js.reply(message, "Please specify a name, a description, and a points value.");
			}
		}else{
			chat.js.reply(message, "Your rank is not high enough to manage achievements.");
		}
	},
	remove: function(message, args, rank){
		if(auth.js.rankgeq(rank, self.config.achievementManageRank)){
			if(args.length>0){
				let id = toId(args[0]);
				if(!id){
					chat.js.reply(message, "The name needs at least one alphanumeric character.");
				}else{
					pgclient.js.runSql(DELETE_ACHIEVEMENT_BY_NAME_SQL, [id], ()=>{}, ()=>{
						pgclient.js.runSql(DELETE_ACHIEVEMENT_SQL, [id], (row)=>{
						},(res)=>{
							if(res.rowCount===0){
								chat.js.reply(message, "That achievement doesn't exist.");
							}else{
								chat.js.reply(message, "Successfully removed the achievement.");
							}
						},(err)=>{
							error(err);
							chat.js.reply(message, "Something went wrong when deleting the achievement.");
						});
					}, (err)=>{
						error(err);
						chat.js.reply(message, "Something went wrong when deleting the achievement.");
					});
				}
			}else{
				error(err);
				chat.js.reply(message, "Please specify a name, a description, and a points value.");
			}
		}else{
			error(err);
			chat.js.reply(message, "Your rank is not high enough to manage achievements.");
		}
	},
	list: function(message, args, rank){ //TODO: Allow a user to be specified, in which case it will list their achievements
		let output = "ACHIEVEMENT LIST\n################\n\n";
		pgclient.js.runSql(GET_ALL_ACHIEVEMENTS_SQL, [], (row)=>{
			output+="Name: " + row.name + ", Points: " + row.value + ", Description: \n" + row.description + "\n\n";
		}, (res)=>{
			request.post({url:'https://hastebin.com/documents', body: output}, function(err,httpResponse,body){
				try{
					chat.js.reply(message, "Here are the achievements: hastebin.com/" + JSON.parse(body).key);
				}catch(e){
					error(e.message);
					chat.js.reply(message, "Something was wrong with the response from hastebin.");
				}
			});
		}, (err)=>{
			chat.js.reply(message, "Something went wrong when getting the achievement list.")
		});
	},
	award: function(message, args, rank){
		info(args);
		if(!auth.js.rankgeq(rank,self.config.achievementManageRank)){
			chat.js.reply(message, "Your rank is not high enough to manage achievements.");
		}else if(args.length<2){
			chat.js.reply(message, "You must specify the user and the achievement.");
		}else{
			awardAchievement(args[0], args[1], (result)=>{chat.js.reply(message, result)}, (result)=>{chat.js.reply(message, result)});
		}
	},
	unaward: function(message, args, rank){
		if(!auth.js.rankgeq(rank,self.config.achievementManageRank)){
			chat.js.reply(message, "Your rank is not high enough to manage achievements.");
		}else if(args.length<2){
			chat.js.reply(message, "You must specify the user and the achievement.");
		}else{
			let username = args[0];
			let achievement = toId(args[1]);
			pgclient.js.getId(username, false, (user)=>{
				if(!user){
					chat.js.reply(message, "That user does not exist.");
					return;
				}
				let achievementid;
				pgclient.js.runSql(GET_ACHIEVEMENT_BY_NAME_SQL, [achievement], (row)=>{
					achievementid = row.id;
				}, (res)=>{
					if(!achievementid){
						chat.js.reply(message, "There's no achievement with that name.");
					}else{
						pgclient.js.runSql(DELETE_PLAYER_ACHIEVEMENT_SQL, [user.id, achievementid], null, (res)=>{
							if(res.rowCount===0){
								chat.js.reply(message, user.display_name + " doesn't have that achievement.");
							}else{
								chat.js.reply(message, "Successfully removed the achievement.");
							}
						}, (err)=>{
							error(err);
							chat.js.reply(message, "Something went wrong removing the achievement.");
						})
					}
				}, (err)=>{
					error(err);
					chat.js.reply(message, "Something went wrong getting the achievement.");
				});
			}, (err)=>{
				error(err);
				chat.js.reply(message, "Something went wrong getting the user.");
			});
		}
	},
	check: function(message, args, rank){
		let username = args[0] || message.user;
		pgclient.js.getId(username, false, (user)=>{
			if(!user){
				chat.js.reply(message, "The user " + username + " doesn't exist.");
			}else{
				let output = user.display_name + "'s achievements:\n";
				pgclient.js.runSql(GET_PLAYER_ACHIEVEMENTS_SQL, [user.id], (row)=>{
					output += row.name + "\n";
				},(res)=>{
					request.post({url:'https://hastebin.com/documents', body: output}, function(err,httpResponse,body){
						try{
							chat.js.reply(message, "Here are " + user.display_name + "'s achievements: hastebin.com/" + JSON.parse(body).key);
						}catch(e){
							error(e.message);
							chat.js.reply(message, "Something was wrong with the response from hastebin.");
						}
					});
				},(err)=>{
					error(err);
					chat.js.reply(message, "There was a problem getting " + user.display_name + "'s achievements.");
				});
			}
		}, (err)=>{
			error(err);
			chat.js.reply(message, "There was a problem when getting the user.");
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
	pgclient.js.getId(username, true, (user)=>{
		let achievementid;
		pgclient.js.runSql(GET_ACHIEVEMENT_BY_NAME_SQL, [achievement], (row)=>{
			achievementid = row.id;
			username = row.name
		}, (res)=>{
			if(!achievementid){
				onFailure("Tried to give " + username + " the achievement " + achievement + ", but it doesn't exist.");
			}else{
				pgclient.js.runSql(INSERT_PLAYER_ACHIEVEMENT_SQL, [user.id, achievementid], null, (res)=>{
					onSuccess(user.display_name, username);
				}, (err)=>{
					error(err);
					onFailure("Tried to give " + username + " the achievement " + achievement + ", but something went wrong. Maybe the already had it.");
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
