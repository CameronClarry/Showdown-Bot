let fs = require("fs");
let request = require("request");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let data = {};
let config = defaultConfigs;

const GOVERNING_ROOM = "scholastic";
exports.GOVERNING_ROOM = GOVERNING_ROOM;

exports.onLoad = function(module, shouldLoadData, oldData){
	self = module;
	refreshDependencies();
	if(oldData) data = oldData;
	if(shouldLoadData){
		data = {
			qotd: {
				question: "",
				submissions: []},
			news: [],
			philqs: []
		};
		data.qotd = {
			question: "",
			submissions: []
		};
		loadData();
	}
};
exports.onUnload = function(){

};
let refreshDependencies = function(){
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
	article: "news",
	art: "news",
	na: "news",
	news: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0){
			if(!AuthManager.rankgeq(commandRank,"+")){
				room.broadcast(user, "You don't have the required rank in Scholastic to update the news.", rank);
			}else{
				if(!data.news){
					data.news = [];
				}
				data.news.unshift({
					url: args.join(", "),
					from: user.name,
					when: new Date().toUTCString()
				});
				saveData();
				room.broadcast(user, "Added this to the news list: " + url, rank);
			}
		}else{
			if(message.room !== "scholastic" && message.room !== ""){
				room.broadcast(user, "This is not the place for news.", rank);
			}else if(data.news.length == 0){
				room.broadcast(user, "There are no news articles.", rank);
			}else{
				room.broadcast(user, data.news[Math.ceil(Math.pow(data.news.length+1, Math.random()))-2].url, rank);
			}
		}
	},
	qotw: "qotd",
	qotd: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length){
			if(!AuthManager.rankgeq(commandRank,"@")){
				room.broadcast(user, "There is no question currently.", rank);
			}else{
				data.qotd.question = args[0];
				data.qotd.submissions = {};
				room.broadcast(user, "Set the current question to be " + args[0] + ".", rank);
				saveData();
			}
		}else if(data.qotd.question){
			room.broadcast(user, "Here is the question: " + data.qotd.question + ". To submit your answer, PM me ~submit followed by your answer, either as text or a link to a picture/pastebin/etc.", rank);
		}else{
			room.broadcast(user, "There is no question currently.", rank);
		}
	},
	submit: function(message, args, user, rank, room, commandRank, commandRoom){
		let response = "You need to include what you're submitting.";
		if(args.length === 0){
			room.broadcast(user, "You need to include what you're submitting.", rank);
		}else{
			if(data.qotd.submissions[user.id]){
				room.broadcast(user, "Your submission has been changed.", rank);
			}else{
				room.broadcast(user, "Your submission has been received.", rank);
			}
			data.qotd.submissions[user.id] = {
				answer: args.join(","),
				user: user.name,
				date: new Date().toUTCString()
			};
			saveData();
		}
	},
	solution: function(message, args, user, rank, room, commandRank, commandRoom){
		let response = "There is no solution currently.";
		if(args.length>0){
			if(AuthManager.rankgeq(commandRank,"@")){
				data.qotd.solution = args[0];
				saveData();
				room.broadcast(user, "Set the current solution to be " + args[0] + ".", rank);
			}else{
				room.broadcast(user, "Your rank is not high enough to change the solution.", rank);
			}
		}else if(data.qotd.question){
			room.broadcast(user, "Here is the solution to the previous question: " + data.qotd.solution + ".", rank);
		}
	},
	discq: function(message, args, user, rank, room, commandRank, commandRoom){
		//Scholastic voices use this to dispense a random question
		if(!AuthManager.rankgeq(commandRank, "+")){
			room.broadcast(user, "Your rank is not high enough to display questions.", rank);
		}else if(data.philqs.length === 0){
			room.broadcast(user, "There are no questions.", rank);
		}else{
			room.broadcast(user, data.philqs[Math.floor(Math.random()*data.philqs.length)], rank);
		}
	},
	discqlist: function(message, args, user, rank, room, commandRank, commandRoom){
		//If the required rank is met, upload the current question set and give a link
		if(!AuthManager.rankgeq(commandRank, "@")){
			room.broadcast(user, "Your rank is not high enough to see the question list.", rank);
		}else if(data.qlist.length === 0){
			room.broadcast(user, "There are currently no questions.", rank);
		}else{
			let text = data.qlist.join("\n");
			uploadText(text, (link)=>{
				user.send(link);
			}, (err)=>{
				user.send("There was an error: " + err);
			});
		}
	},
	discqset: function(message, args, user, rank, room, commandRank, commandRoom){
		//If the required rank is met, update question set to given hastbin link
		let response = "oops";
		let success = false;
		if(!AuthManager.rankgeq(commandRank, "#")){
			user.send("Your rank is not high enough to set the questions.");
		}else if(args.length === 0){
			user.send("You must give a link to the questions.");
		}else if(/^(https?:\/\/)?(www\.)?hastebin.com\/raw\/[a-z]+$/.test(args[0])){
			request.get(args[0],function(err, response, body){
				if(err){
						error(err);
						user.send(err);
						return;
				}
				let questions = body.split("\n");
				if(questions.length === 0){
					user.send("No questions were found.");
				}else{
					data.philqs = questions;
					saveData();
					user.send("Set the question list, there are now " + questions.length + " questions.");
				}
			});
		}else{
			user.send("There was something wrong with your link, make sure it's only the raw paste.");
		}
	}
};

let saveData = function(){
	try{
		let filename = "data/scholdata.json";
		let dataFile = fs.openSync(filename,"w");
		fs.writeSync(dataFile,JSON.stringify(data, null, "\t"));
		fs.closeSync(dataFile);
	}catch(e){
		error(e.message);
	}
};

let loadData = function(){
	let result = "Could not load the data file.";
	try{
		let filename = "data/scholdata.json";
		if(fs.existsSync(filename)){
			data = JSON.parse(fs.readFileSync(filename, "utf8"));
			result = "Found and loaded the data file.";
		}else{
			let dataFile = fs.openSync(filename,"w");
			fs.writeSync(dataFile,JSON.stringify(data, null, "\t"));
			fs.closeSync(dataFile);
			result = "Could not find the data file, made a new one.";
		}
	}catch(e){
		error(e.message);
	}
	info(result);
};


let defaultConfigs = {
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
};

exports.configTypes = configTypes;
