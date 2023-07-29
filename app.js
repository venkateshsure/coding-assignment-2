const express = require("express");
const app = express();
const sqlite = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const filePath = path.join(__dirname, "twitterClone.db");

let db = null;

const dbObject = async () => {
  try {
    db = await sqlite.open({ filename: filePath, driver: sqlite3.Database });
  } catch (e) {
    console.log(e.message);
  }
};

app.use(express.json());

app.listen(3000, () => {
  console.log("server is running");
});

// Authentication Middleware

const authenticate = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  /*if (!authorization || !authorization.startsWith("Bearer ")) {
    res.status(401);
    return res.send("Invalid JWT Token");
  }*/
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
    console.log(jwtToken);
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "venky", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};
// Initialize the database
dbObject();
module.exports = app;

// API 1: User Registration
app.post("/register/", async (req, res) => {
  const { username, password, name, gender } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const query = `SELECT * FROM user WHERE username='${username}';`;
  const response = await db.get(query);
  console.log(response);
  if (response !== undefined) {
    res.status(400);
    res.send("User already exists");
  } else {
    if (password.length < 6) {
      res.status(400);
      res.send("Password is too short");
    } else {
      const userCreateQuery = `INSERT INTO user (name, username, password, gender) VALUES ('${name}', '${username}', '${hashedPassword}', '${gender}');`;
      await db.run(userCreateQuery);
      res.status(200);
      res.send("User created successfully");
    }
  }
});

// API 2: User Login
app.post("/login/", async (req, res) => {
  const { username, password } = req.body;
  const query = `SELECT * FROM user WHERE username='${username}';`;
  const response = await db.get(query);
  if (response === undefined) {
    res.status(400);
    res.send("Invalid user");
  } else {
    const checkPassword = await bcrypt.compare(password, response.password);
    if (checkPassword === true) {
      const payload = { username: username };
      //console.log(payload);
      const jwtToken = jwt.sign(payload, "venky");
      console.log(jwtToken);
      res.send({ jwtToken: jwtToken });
    } else {
      res.status(400);
      res.send("Invalid password");
    }
  }
});

//API 3: Get the latest 4 tweets of people whom the user follows
app.get("/user/tweets/feed/", authenticate, async (req, res) => {
  const { username } = req;
  const query = `
    SELECT user.username, tweet.tweet, tweet.date_time AS dateTime
            FROM user
            INNER JOIN follower ON user.user_id = follower.following_user_id
            INNER JOIN tweet ON tweet.user_id = follower.follower_user_id
            WHERE user.username = '${username};'
            ORDER BY tweet.date_time DESC
            LIMIT 4;
`;

  const response = await db.all(query);
  res.send(response);
});

// API 4: Get the list of all names of people whom the user follows
app.get("/user/following/", authenticate, async (req, res) => {
  const { username } = req;
  const query = `
    SELECT user.username AS name
    FROM user
    INNER JOIN follower  ON user.user_id = following.follower_user_id
    WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${username}');`;

  const response = await db.all(query);
  res.send(response);
});

// API 5: Get the list of all names of people who follow the user
app.get("/user/followers/", authenticate, async (req, res) => {
  const { username } = req;
  const query = `
    SELECT user.username AS name
    FROM user
    INNER JOIN follower ON user.user_id = follower.follower_user_id
    WHERE follower.following_user_id = (SELECT user_id FROM user WHERE username = '${username}');`;

  const response = await db.all(query);
  res.send(response);
});

// API 6: Get tweet details by tweetId
app.get("/tweets/:tweetId/", authenticate, async (req, res) => {
  const { tweetId } = req.params;
  const { username } = req;

  const query = `
    SELECT t.tweet, COUNT(l.like_id) AS likes, COUNT(r.reply_id) AS replies, t.date_time AS dateTime
    FROM tweet AS t
    LEFT JOIN like AS l ON t.tweet_id = l.tweet_id
    LEFT JOIN reply AS r ON t.tweet_id = r.tweet_id
    WHERE t.tweet_id = ${tweetId}
    AND t.user_id IN (SELECT following_user_id FROM follower WHERE follower_user_id = (SELECT user_id FROM user WHERE username = '${username}'))
    GROUP BY t.tweet_id;`;

  const response = await db.get(query);
  if (response !== undefined) {
    res.send(response);
  } else {
    res.status(401).send("Invalid Request");
  }
});

// API 7: Get the list of usernames who liked a tweet
app.get("/tweets/:tweetId/likes/", authenticate, async (req, res) => {
  const { tweetId } = req.params;
  const { username } = req;

  const query = `
    SELECT u.username AS likes
    FROM like AS l
    JOIN user AS u ON l.user_id = u.user_id
    WHERE l.tweet_id = ${tweetId}
    AND l.tweet_id IN (SELECT tweet_id FROM tweet WHERE user_id IN (SELECT following_user_id FROM follower WHERE follower_user_id = (SELECT user_id FROM user WHERE username = '${username}')));`;

  const response = await db.all(query);
  res.send({ likes: response.map((like) => like.likes) });
});

// API 8: Get the list of replies to a tweet
app.get("/tweets/:tweetId/replies/", authenticate, async (req, res) => {
  const { tweetId } = req.params;
  const { username } = req;

  const query = `
    SELECT u.username AS name, r.reply
    FROM reply AS r
    JOIN user AS u ON r.user_id = u.user_id
    WHERE r.tweet_id = ${tweetId}
    AND r.tweet_id IN (SELECT tweet_id FROM tweet WHERE user_id IN (SELECT following_user_id FROM follower WHERE follower_user_id = (SELECT user_id FROM user WHERE username = '${username}')));`;

  const response = await db.all(query);
  res.send({ replies: response });
});

// API 9: Get all tweets of the user
app.get("/user/tweets/", authenticate, async (req, res) => {
  const { username } = req;
  const query = `
    SELECT t.tweet, COUNT(l.like_id) AS likes, COUNT(r.reply_id) AS replies, t.date_time AS dateTime
    FROM tweet AS t
    LEFT JOIN like AS l ON t.tweet_id = l.tweet_id
    LEFT JOIN reply AS r ON t.tweet_id = r.tweet_id
    WHERE t.user_id = (SELECT user_id FROM user WHERE username = '${username}')
    GROUP BY t.tweet_id;`;

  const response = await db.all(query);
  res.send(response);
});

// API 10: Create a tweet
app.post("/user/tweets/", authenticate, async (req, res) => {
  const { username } = req;
  const { tweet } = req.body;
  const datetime = new Date().toISOString().slice(0, 19).replace("T", " ");

  const insertTweetQuery = `INSERT INTO tweet (tweet, user_id, date_time) VALUES ('${tweet}', (SELECT user_id FROM user WHERE username = '${username}'), '${datetime}');`;

  await db.run(insertTweetQuery);
  res.send("Created a Tweet");
});

// API 11: Delete a tweet
app.delete("/tweets/:tweetId/", authenticate, async (req, res) => {
  const { tweetId } = req.params;
  const { username } = req;

  const deleteTweetQuery = `
    DELETE FROM tweet 
    WHERE tweet_id = ${tweetId} AND user_id = (SELECT user_id FROM user WHERE username = '${username}');`;

  await db.run(deleteTweetQuery);
  res.send("Tweet Removed");
});
