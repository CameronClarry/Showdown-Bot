let fs = require('fs');
let request = require('request');

let commands = {
	article: 'news',
	art: 'news',
	na: 'news',
	news: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, '+') && args.length > 0){
			room.broadcast(user, "You don't have the required rank in Scholastic to update the news.");
			return;
		}

		if(args.length > 0){
			if(!this.news){
				this.news = [];
			}
			let url = args.join(', ');
			this.news.unshift({
				url: url,
				from: user.name,
				when: new Date().toUTCString()
			});
			this.saveData();
			room.broadcast(user, "Added this to the news list: " + url);
		}else{
			if(room.id !== 'scholastic' && room.id !== ''){
				room.broadcast(user, "This is not the place for news.");
			}else if(this.news.length == 0){
				room.broadcast(user, "There are no news articles.");
			}else{
				room.broadcast(user, this.news[Math.ceil(Math.pow(this.news.length+1, Math.random()))-2].url);
			}
		}
	},
	qotw: 'qotd',
	qotd: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length && AuthManager.rankgeq(commandRank, '@')){
			this.qotd.question = args.join(', ');
			this.qotd.submissions = {};
			this.saveData();
			room.broadcast(user, `Set the current question to be \`\`${args.join(', ')}\`\`.`);
		}else if(this.qotd.question){
			room.broadcast(user, `Here is the question: ${this.qotd.question}. To submit your answer, PM me ~submit followed by your answer, either as text or a link to a picture/pastbin/etc.`);
		}else{
			room.broadcast(user, "There is no question currently.");
		}
	},
	submit: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length === 0){
			room.broadcast(user, "You need to include what you're submitting.");
		}else{
			if(this.qotd.submissions[user.id]){
				room.broadcast(user, "Your submission has been changed.");
			}else{
				room.broadcast(user, "Your submission has been received.");
			}
			this.qotd.submissions[user.id] = {
				answer: args.join(', '),
				user: user.name,
				date: new Date().toUTCString()
			};
			this.saveData();
		}
	},
	solution: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length > 0 && AuthManager.rankgeq(commandRank, '@')){
			this.qotd.solution = args[0];
			this.saveData()
			room.broadcast(user, `Set the current solution to be ${args[0]}.`);
		}else if(this.qotd.question){
			room.broadcast(user, `Here is the solution to the previous question: ${this.qotd.solution}.`);
		}else{
			room.broadcast(user, "There is no solution currently.");
		}
	},
	discq: function(message, args, user, rank, room, commandRank, commandRoom){
		//Scholastic voices use this to dispense a random question
		if(!AuthManager.rankgeq(commandRank, '+')){
			room.broadcast(user, "Your rank is not high enough to display questions.");
		}else if(this.philqs.length === 0){
			room.broadcast(user, "There are no questions.");
		}else{
			room.broadcast(user, this.philqs[Math.floor(Math.random()*this.philqs.length)]);
		}
	},
	discqlist: function(message, args, user, rank, room, commandRank, commandRoom){
		//If the required rank is met, upload the current question set and give a link
		if(!AuthManager.rankgeq(commandRank, '@')){
			room.broadcast(user, "Your rank is not high enough to see the question list.");
		}else if(this.philqs.length === 0){
			room.broadcast(user, "There are currently no questions.");
		}else{
			let text = this.philqs.join('\n');
			uploadText(text, (link)=>{
				user.send(link);
			}, (err)=>{
				user.send(`Error: ${err}`);
			});
		}
	},
	discqset: function(message, args, user, rank, room, commandRank, commandRoom){
		//If the required rank is met, update question set to given hastbin link
		if(!AuthManager.rankgeq(commandRank, '#')){
			user.send("Your rank is not high enough to set the questions.");
		}else if(args.length === 0){
			user.send("You must give a link to the questions.");
		}else if(/^(https?:\/\/)?(www\.)?hastebin.com\/raw\/[a-z]+$/.test(args[0])){
			request.get(args[0], function(err, response, body){
				if(err){
						error(err);
						user.send(err);
						return;
				}

				let questions = body.split('\n');
				if(questions.length === 0){
					user.send("No questions were found.");
				}else{
					data.philqs = questions;
					saveData();
					user.send(`Set the question list, there are now ${questions.length} questions.`);
				}
			});
		}else{
			user.send("There was something wrong with your link, make sure it's only the raw paste.");
		}
	}
};

class Scholastic extends BaseModule{
	constructor(){
		super();
		this.room = Scholastic.room;
		this.config = {};
		this.commands = commands;
		this.qotd = {
			question: '',
			submissions: []
		};
		this.news = [];
		this.philqs = [];
	}

	onLoad(){
		this.loadData();
	}

	recover(oldModule){
		this.qotd = oldModule.qotd;
		this.news = oldModule.news;
		this.philqs = oldModule.philqs;
	}

	loadData(){
		try{
			let path = 'data/scholdata.json';
			if(fs.existsSync(path)){
				let data = JSON.parse(fs.readFileSync(path, 'utf8'));
				this.qotd = data.qotd;
				this.news = data.news;
				this.philqs = data.philqs;
				return true;
			}
		}catch(e){
			error(e.message);
		}
		return false;
	}

	saveData(){
		let data = {
			qotd: this.qotd,
			news: this.news,
			philqs: this.philqs,
		};
		try{
			let path = 'data/scholdata.json';
			let dataFile = fs.openSync(path,'w');
			fs.writeSync(dataFile,JSON.stringify(data, null, '\t'));
			fs.closeSync(dataFile);
			return true;
		}catch(e){
			error(e.message);
		}
		return false;
	}
}
Scholastic.room = 'scholastic';

exports.Module = Scholastic;
