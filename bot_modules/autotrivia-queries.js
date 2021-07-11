//vim: set foldmethod=marker:

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

// {{{ VERSION MOVE DIFFERENCES


let pokemonByVersionMoveDifferences = function(callback){
	const EXCLUSIVE_LEVELUP_MOVE = `SELECT pokemon.name, ms1.pokemon_id, ms1.game_name, ms1.move_name
	FROM movesets AS ms1
	INNER JOIN pokemon ON ms1.pokemon_id = pokemon.id
	LEFT JOIN movesets AS ms2 ON ms1.pokemon_id = ms2.pokemon_id AND ms1.move_name = ms2.move_name AND ms1.game_name != ms2.game_name AND ms2.learn_method = 1
	WHERE ms1.game_name != 'rby'
	AND ms1.learn_method = 1
	AND ms2.pokemon_id IS NULL;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let row = rows[Math.floor(Math.random()*rows.length)];
		console.log(row);

		// Filter to just rows that have that pokemon and game
		filteredRows = rows.filter((e)=>{return e.pokemon_id === row.pokemon_id && e.game_name === row.game_name});
		pokemonName = row.name;
		gameName = row.game_name === 'y' ? 'Pokemon Yellow' : 'Pokemon Red and Blue';
		answers = filteredRows.map((e)=>{return e.move_name});
		question = `In Generation I, ${pokemonName} learns this move by level up only in ${gameName}.`;

		callback(null, question, answers);
	};
	this.pgclient.runSql(EXCLUSIVE_LEVELUP_MOVE , [], newCallback);
};

// }}} 

// {{{ SIGNATURE MOVES


let signatureMoves = function(callback){
	const EXCLUSIVE_MOVE = `WITH family_counts AS (
		SELECT move_name, COUNT(DISTINCT pokemon.family_id) AS family_count, COUNT(DISTINCT pokemon.id)::int AS pokemon_count, MAX(pokemon.family_id) AS family_id, MAX(pokemon.id) AS pokemon_id
		FROM movesets
		INNER JOIN pokemon ON pokemon.id = movesets.pokemon_id
		GROUP BY move_name
	)
	SELECT move_name, family_count, pokemon_count, families.name AS family_name, pokemon.name AS pokemon_name
	FROM family_counts
	INNER JOIN families ON families.id = family_counts.family_id
	INNER JOIN pokemon ON pokemon.id = family_counts.pokemon_id
	WHERE family_count = 1;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let row = rows[Math.floor(Math.random()*rows.length)];
		console.log(row);

		// Filter to just rows that have that pokemon and game
		filteredRows = rows.filter((e)=>{return e.family_name === row.family_name});

		let question, answers;
		if(Math.random() < 0.5){
			// Ask which line/pokemon
			//let ending = row.pokemon_count === 1 ? `unique to ${row.pokemon_name}` : `signature to the ${row.family_name} line`;
			let ending = row.pokemon_count === 1 ? `unique to this Pokemon` : `signature to this evolutionary line`;
			question = `In Generation I, ${row.move_name} is ${ending}.`
			answers = filteredRows.map((e)=>{return row.pokemon_count === 1 ? row.pokemon_name : row.family_name});
		}else{
			// Ask which move
			let ending = row.pokemon_count === 1 ? `unique to ${row.pokemon_name}` : `signature to the ${row.family_name} line`;
			question = `In Generation I, this move is ${ending}.`;
			answers = filteredRows.map((e)=>{return row.move_name});
		}

		callback(null, question, answers);
	};
	this.pgclient.runSql(EXCLUSIVE_MOVE, [], newCallback);
};

// }}}

// {{{ FINAL LEVEL UP MOVES


let finalLevelUpMove = function(callback){
	const FINAL_LEVEL_UP_MOVE = `WITH max_levels AS (
		SELECT MAX(learn_level) AS max_level, pokemon_id
		FROM movesets
		GROUP BY pokemon_id
	)
	SELECT pokemon.name, pokemon.short_name, movesets.move_name, movesets.game_name, movesets.learn_level
	FROM pokemon
	INNER JOIN movesets ON pokemon.id = movesets.pokemon_id
	INNER JOIN max_levels ON max_levels.max_level = movesets.learn_level AND pokemon.id = max_levels.pokemon_id
	WHERE movesets.learn_method = 1
	AND max_levels.max_level > 1;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let row = rows[Math.floor(Math.random()*rows.length)];
		console.log(row);

		let question = `This is the final move that ${row.name} learns by level up in Generation I.`;
		let answers = [row.move_name];

		callback(null, question, answers);
	};
	this.pgclient.runSql(FINAL_LEVEL_UP_MOVE, [], newCallback);
}

// }}}

// {{{ LEARNS MOVE

let twoMovePokemon = function(move1_name, move2_name, callback){
	const TWO_MOVE_LEARN_COUNTS = `SELECT DISTINCT pokemon.name
	FROM movesets AS ms1
	INNER JOIN movesets AS ms2 ON ms1.pokemon_id = ms2.pokemon_id
	INNER JOIN pokemon ON pokemon.id = ms1.pokemon_id
	WHERE ms1.learn_method = 1 AND ms1.move_name = '${move1_name}'
	AND ms2.learn_method = 1 AND ms2.move_name = '${move2_name}';`;

	let newCallback = (err, res) =>{
		console.log("inside final part");
		if(err){
			callback(err);
			return;
		}

		// Get array of rows
		let rows = res.rows;

		let question = `In Generation I, this Pokemon learns both ${move1_name} and ${move2_name} by level up.`;
		let answers = rows.map((e)=>{return e.name});

		callback(null, question, answers);
	};
	this.pgclient.runSql(TWO_MOVE_LEARN_COUNTS, [], newCallback);
}

let twoMoveCounts = function(move_name, callback){
	const TWO_MOVE_LEARN_COUNTS = `SELECT ms2.move_name, COUNT(DISTINCT ms2.pokemon_id)::int AS learn_num
	FROM movesets AS ms1
	INNER JOIN movesets AS ms2 ON ms1.pokemon_id = ms2.pokemon_id AND ms2.learn_method = 1
	WHERE ms1.move_name = '${move_name}' AND ms1.learn_method = 1 AND ms2.move_name != ms1.move_name
	GROUP BY ms2.move_name;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows
		let rows = res.rows;

		let row = rows[Math.floor(Math.random()*rows.length)];
		console.log(row);

		twoMovePokemon.call(this, move_name, row.move_name, callback);
	};
	this.pgclient.runSql(TWO_MOVE_LEARN_COUNTS, [], newCallback);
}


let moveCounts = function(callback){
	const MOVE_LEARN_COUNTS = `SELECT move_name, COUNT(DISTINCT pokemon_id)::int AS learn_num, COUNT(DISTINCT family_id)::int AS family_num
	FROM movesets
	INNER JOIN pokemon ON pokemon.id = movesets.pokemon_id
	WHERE learn_method = 1
	GROUP BY move_name;`;
	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows
		let rows = res.rows;
		// We don't want rows that are signature or exclusive
		let filteredRows = rows.filter((e)=>{return e.family_num > 1});

		let row = filteredRows[Math.floor(Math.random()*filteredRows.length)];
		console.log(row);

		// Decide how to handle the row
		twoMoveCounts.call(this, row.move_name, callback);
	};
	this.pgclient.runSql(MOVE_LEARN_COUNTS, [], newCallback);
}

// }}}

// {{{ LEVEL 1 MOVES

let firstLevelMove = function(callback){
	const LEVEL_ONE_MOVE = `SELECT pokemon.name, pokemon.short_name, movesets.move_name
	FROM pokemon
	INNER JOIN movesets ON pokemon.id = movesets.pokemon_id
	WHERE movesets.learn_method = 1
	AND movesets.learn_level = 1;`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let row = rows[Math.floor(Math.random()*rows.length)];
		console.log(row);
		let question, answer;

		if(Math.random() < 0.5){
			// Ask which pokemon
			filteredRows = rows.filter((e)=>{return e.move_name === row.move_name});
			question = `In Generation I, this Pokemon learns ${row.move_name} at level 1.`
			answers = filteredRows.map((e)=>{return e.short_name});
		}else{
			// Ask which move
			filteredRows = rows.filter((e)=>{return e.short_name === row.short_name});
			question = `In Generation I, ${row.name} learns this move at level 1.`;
			answers = filteredRows.map((e)=>{return e.move_name});
		}

		callback(null, question, answers);
	};
	this.pgclient.runSql(LEVEL_ONE_MOVE, [], newCallback);
}

// }}}

let baseQueries = [
	{
		func: pokemonByVersionMoveDifferences,
		weight: 1
	},
	{
		func: signatureMoves,
		weight: 1
	},
	{
		func: finalLevelUpMove,
		weight: 1
	},
	{
		func: moveCounts,
		weight: 1
	},
	{
		func: firstLevelMove,
		weight: 1
	}
];



makecdf(baseQueries);

exports.baseQueries = baseQueries;
