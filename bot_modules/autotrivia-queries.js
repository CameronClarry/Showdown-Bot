//vim: set foldmethod=marker:

const fs = require('fs');

let makecdf = function(arr){
	let totalWeight = 0;
	for(let i=0;i<arr.length;i++){
		totalWeight += arr[i].weight;
	}
	let cdf = 0;
	for(let i=0;i<arr.length;i++){
		cdf += arr[i].weight/totalWeight;
		arr[i].cdf = cdf;
	}
}

// Make a number of 'base' queries that narrow down the pokemon selection (eg pokemon learns given move).
// Each of these queries leads to another set of queries to narrow the selection further if needed.
// For example, if the move chosen was high jump kick, only one pokemon learns it by level up so there is
// no need to refine the search any more, asking "this pokmeon learns high jump kick by level up" is fine.
// However, 18 pokemon learn bite so "this pokemon learns bite by level up" would not make a good question.
// Another filter would have to be added, for example putting another move into the restriction or ordering
// by a stat. Each filter is a function that takes in the information from the previous filter (if there was one),
// and a callback to give the finished question to. If the filter doesn't narrow the search down enough it
// passes the question callback further along the line to be refined.

// TODO add groups of pokemon: starters, legendaries, legendary birds, etc
// TODO add evolutions - pokemon 1, pokemon 2, method, level


questionTypes = [];
// make array for question types
// load each query file and add its questions to the array
queryFiles = fs.readdirSync('bot_modules/queries/');
console.log(queryFiles);
for(let i=0;i<queryFiles.length;i++){
	console.log(queryFiles[i]);
	if(!queryFiles[i].match(/\.js$/)) continue;
	let path = `./queries/${queryFiles[i]}`
	delete require.cache[require.resolve(path)];
	queryFile = require(path);
	for(let j=0;j<queryFile.questionTypes.length;j++){
		questionTypes.push(queryFile.questionTypes[j]);
	}
}


makecdf(questionTypes);

exports.baseQueries = questionTypes;
