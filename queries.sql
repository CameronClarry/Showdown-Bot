--TABLE CREATION QUERIES

CREATE TABLE users(id SERIAL PRIMARY KEY, username VARCHAR(20) NOT NULL, display_name VARCHAR(20) NOT NULL);

CREATE TABLE alts(username VARCHAR(20) PRIMARY KEY NOT NULL, main_id INT NOT NULL);

CREATE TABLE tt_points(id INT NOT NULL, leaderboard VARCHAR(20) NOT NULL, points INT NOT NULL, PRIMARY KEY(id, leaderboard));

CREATE TABLE tt_leaderboards(id VARCHAR(20) PRIMARY KEY NOT NULL, display_name VARCHAR(20) NOT NULL, created_on TIMESTAMP NOT NULL, created_by INT NOT NULL, enabled BOOLEAN NOT NULL);

CREATE TABLE wl_lb(id INT PRIMARY KEY NOT NULL, correct INTEGER NOT NULL, incorrect INTEGER NOT NULL, passed INTEGER NOT NULL, wins INTEGER NOT NULL, banked INTEGER NOT NULL, won INTEGER NOT NULL);

--####################
--USER AND ALT QUERIES
--####################

--INSERT_USER_SQL
INSERT INTO users (username, display_name) VALUES ($1, $2);

--DELETE_USER_SQL
DELETE FROM users WHERE id = $1;

--INSERT_ALT_SQL
INSERT INTO alts (username, main_id) VALUES ($1, (SELECT id FROM users WHERE username = $2 FETCH FIRST 1 ROWS ONLY));

--DELETE_ALT_SQL
DELETE FROM alts WHERE username = $1;

--GET_USER_SQL
SELECT users.id, users.username, users.display_name FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 FETCH FIRST 1 ROWS ONLY;

--GET_ALTS_SQL
SELECT username FROM alts WHERE main_id = $1;

--UPDATE_USER_SQL
UPDATE users SET display_name = $2 WHERE id = $1;

--UPDATE_MAINS_SQL
UPDATE alts SET main_id = $2 WHERE main_id = $1;

--GET_MAINS_SQL
SELECT alts.username, id, display_name, TRUE AS is_first FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 UNION SELECT alts.username, id, display_name, FALSE AS is_first FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $2;

--###################
--LEADERBOARD QUERIES
--###################

--INSERT_LB_SQL
INSERT INTO tt_leaderboards VALUES($1, $2, CURRENT_TIMESTAMP, $3, true);

--DELETE_LB_SQL
DELETE FROM tt_leaderboards WHERE id = $1;

--GET_LB_SQL
SELECT lb.id, lb.display_name, lb.created_on, users.display_name AS created_by, lb.enabled FROM tt_leaderboards AS lb LEFT OUTER JOIN users ON lb.created_by = users.id WHERE lb.id = $1;

--GET_ALL_LB_SQL
SELECT * FROM tt_leaderboards;

--GET_ACTIVE_LB_SQL
SELECT * FROM tt_leaderboards WHERE enabled = TRUE;

--RESET_MAIN_LB_SQL
UPDATE tt_leaderboards SET created_on = CURRENT_TIMESTAMP, created_by = $3 WHERE id = 'main';

--UPDATE_LB_SQL
UPDATE tt_leaderboards SET enabled = $2 WHERE id = $1;

--#################
--TT_POINTS QUERIES
--#################

--GET_LB_ENTRY_SQL
SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE lb.id = $1 AND lb.leaderboard = $2;

--GET_LB_ENTRIES_SQL
SELECT lb.points, users.display_name, lb.leaderboard FROM tt_points AS lb INNER JOIN users ON lb.id = USERS.id WHERE lb.id = $1;

--LSIT_LB_ENTRIES_SQL
SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE lb.leaderboard = $1 ORDER BY lb.points DESC FETCH FIRST _NUMBER_ ROWS ONLY;

--INSERT_LB_ENTRY_SQL
INSERT INTO tt_points VALUES ($1, $2, $3);

--UPDATE_LB_ENTRY_SQL
UPDATE tt_points SET points = $3 WHERE id = $1 AND leaderboard = $2;

--DELETE_LB_ENTRY_SQL
DELETE FROM tt_points WHERE id = $1 AND leaderboard = $2;

--DELETE_USER_ENTRIES_SQL
DELETE FROM tt_points WHERE id = $1;

--DELETE_LB_ENTRIES_SQL
DELETE FROM tt_points WHERE leaderboard = $1;

--GET_ALL_LB_ENTRIES_SQL
SELECT lb.points, users.display_name FROM tt_points AS lb LEFT OUTER JOIN users ON lb.id = users.id WHERE lb.leaderboard = $1 ORDER BY lb.points DESC;
