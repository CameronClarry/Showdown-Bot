let fs = require("fs");
let request = require("request");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let chat = null;
let auth = null;
exports.onLoad = function(module, shouldLoadData){
	self = module;
	self.js.refreshDependencies();
	if(shouldLoadData){
		self.data = {
			qotd: {
				question: "",
				submissions: []},
			news: [],
			philqs: []
		};
		self.data.qotd = {
			question: "",
			submissions: []
		};
		loadData();
	}
	self.chathooks = {
		chathook: function(m){
			if(m && !m.isInit){
				let text = m.message;
				if(text[0]==="~"||text[0]==="."){
					let command = text.split(" ")[0].trim().toLowerCase().substr(1);
					let argText = text.substring(command.length+2, text.length);
					let chatArgs = argText === "" ? [] : argText.split(",");
					for(let i = 0;i<chatArgs.length;i++){
						chatArgs[i] = chatArgs[i].trim();
					}
					if(commands[command]&&auth&&auth.js&&chat&&chat.js){
						let rank = auth.js.getEffectiveRoomRank(m, "scholastic");
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
	chat = getModuleForDependency("chat", "scholastic");
	auth = getModuleForDependency("auth", "scholastic");
};
exports.onConnect = function(){

};

let commands = {
	article: "news",
	art: "news",
	na: "news",
	news: function(message, args, rank){
		if(args.length>0){
			if(auth.js.rankgeq(rank,"+")){
				let url = args.join(",");
				if(!self.data.news){
					self.data.news = [];
				}
				self.data.news.unshift({
					url: url,
					from: message.user,
					when: new Date().toUTCString()
				});
				saveData();
				chat.js.reply(message, "Added this to the news list: " + url);
			}else{
				chat.js.reply(message, "You don't have the required rank in Scholastic to update the news.");
			}
		}else{
			let response = "This is not the place for news.";
			if(message.room === "scholastic" || message.room === "" || message.room === "joim"){
				if(self.data.news.length>0){
					response = self.data.news[Math.ceil(Math.pow(self.data.news.length+1, Math.random()))-2].url;
				}else{
						response = "There are no news articles.";
					}
			}
			chat.js.reply(message, response);
		}
	},
	qotd: function(message, args, rank){
		let response = "There is no question currently.";
		if(args.length){
			if(auth.js.rankgeq(rank,"@")){
				self.data.qotd.question = args[0];
				self.data.qotd.submissions = {};
				response = "Set the current question to be " + args[0] + ".";
				saveData();
			}else{
				response = "Your rank is not high enough to change the question.";
			}
		}else if(self.data.qotd.question){
			response = "Here is the question: " + self.data.qotd.question + ". To submit your answer, PM me ~submit followed by your answer, either as text or a link to a picture/pastebin/etc.";
		}
		chat.js.reply(message, response);
	},
	submit: function(message, args, rank){
		let response = "You need to include what you're submitting.";
		if(args.length){
			let user = toId(message.user);
			if(self.data.qotd.submissions[user]){
				response = "Your submission has been changed.";
			}else{
				response = "Your submission has been received.";
			}
			self.data.qotd.submissions[user] = {
				answer: args.join(","),
				user: message.user,
				date: new Date().toUTCString()
			};
			saveData();
		}
		chat.js.reply(message, response);
	},
	solution: function(message, args, rank){
		let response = "There is no solution currently.";
		if(args.length){
			if(auth.js.rankgeq(rank,"@")){
				self.data.qotd.solution = args[0];
				response = "Set the current solution to be " + args[0] + ".";
				saveData();
			}else{
				response = "Your rank is not high enough to change the solution.";
			}
		}else if(self.data.qotd.question){
			response = "Here is the solution to the previous question: " + self.data.qotd.solution + ". To submit your answer, PM me ~submit followed by your answer, either as text or a link to a picture/pastebin/etc.";
		}
		chat.js.reply(message, response);
	},
	discq: function(message, args, rank){
		//Scholastic voices use this to dispense a random question
		if(auth.js.rankgeq(rank, "+")){
			if(self.data.philqs.length === 0){
				chat.js.reply(message, "There are no questions.");
			}else{
				chat.js.reply(message, self.data.philqs[Math.floor(Math.random()*self.data.philqs.length)]);
			}
		}else{
			chat.js.reply(message, "Your rank is not high enough to display questions.")
		}
	},
	discqlist: function(message, args, rank){
		//If the required rank is met, upload the current question set and give a link
		if(auth.js.rankgeq(rank, "@")){
			let qlist = self.data.philqs;
			if(qlist.length === 0){
				chat.js.reply(message, "There are currently no questions.");
			}else{
				let text = qlist.join("\n");
				uploadText(text, (link)=>{
					chat.js.pm(message.user, link);
				}, (err)=>{
					chat.js.pm(message.user, "There was an error: " + err);
				});
			}
		}else{
			chat.js.reply(message, "Your rank is not high enough to see the question list.");
		}
	},
	discqset: function(message, args, rank){
		//If the required rank is met, update question set to given hastbin link
		let response = "oops";
		let success = false;
		if(!auth.js.rankgeq(rank, "#")){
			response = "Your rank is not high enough to set the questions.";
		}else if(args.length === 0){
			response = "You must give a link to the questions.";
		}else if(/^(https?:\/\/)?(www\.)?hastebin.com\/raw\/[a-z]+$/.test(args[0])){
			success = true;
			let response = "oops again";
			request.get(args[0],function(err, response, body){
				if(err){
						error(err);
						chat.js.reply(message, err);
						return;
				}
				let questions = body.split("\n");
				if(questions.length === 0){
					response = "No questions were found.";
				}else{
					self.data.philqs = questions;
					saveData();
					response = "Set the question list, there are now " + questions.length + " questions.";
				}
				chat.js.pm(message.user, response);
			});
		}else{
			response = "There was something wrong with your link, make sure it's only the raw paste.";
		}
		if(!success){
			chat.js.pm(message.user, response);
		}
	}
};

let saveData = function(){
	try{
		let filename = "data/scholdata.json";
		let dataFile = fs.openSync(filename,"w");
		fs.writeSync(dataFile,JSON.stringify(self.data, null, "\t"));
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
			self.data = JSON.parse(fs.readFileSync(filename, "utf8"));
			result = "Found and loaded the data file.";
		}else{
			let dataFile = fs.openSync(filename,"w");
			fs.writeSync(dataFile,JSON.stringify(self.data, null, "\t"));
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
