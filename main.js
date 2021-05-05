const express = require('express');
const bodyParser = require("body-parser");
const app = express();
const path = require('path');
const fetch = require('node-fetch');
const {MongoClient} = require('mongodb');
require('dotenv').config();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const { auth, requiresAuth } = require('express-openid-connect');
app.use(
  auth({
    authRequired: false,
    auth0Logout: true,
    issuerBaseURL: process.env.ISSUER_BASE_URL,
    baseURL: process.env.BASE_URL,
    clientID: process.env.CLIENT_ID,
    secret: process.env.SECRET,
  })
);

app.use(express.static(__dirname + '/public'));

async function createGame(client, newGame){
  const result = await client.db("photoguesser_games").collection("game_info").insertOne(newGame);
  console.log(`New listing created with the following id: ${result.insertedId}`);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.get("/", (req, res) => {
  res.render("home");
});

app.get("/play", requiresAuth(), async (req, res) => {
  const uri = process.env.DATABASE_URI;
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const currentGame = await client.db("photoguesser_games").collection("game_info").findOne({ user: req.oidc.user.sub, current: true });
    if (currentGame) {
      console.log(currentGame);
      res.render("play", {
        image: currentGame.image,
        latitude: currentGame.lat,
        longitude: currentGame.lon,
        api_url: process.env.API_URL
      });
    } else {
      const api_url = "https://api.teleport.org/api/urban_areas/";
      const response = await fetch(api_url);
      const json = await response.json();
      const count = 266;
      let image_num = Math.floor(Math.random() * 266);

      const country_url = json["_links"]["ua:item"][image_num]["href"];
      const country_response = await fetch(country_url);
      const country_json = await country_response.json();

      const coordinates = country_json["bounding_box"]["latlon"];
      const lat = (coordinates["north"] + coordinates["south"])/2;
      const lon = (coordinates["east"] + coordinates["west"])/2;

      const image_url = country_url + "images";
      const image_response = await fetch(image_url);
      const image_json = await image_response.json();
      const image = image_json["photos"][0]["image"]["web"];

      await createGame(client, {
        user: req.oidc.user.sub,
        current: true,
        image: image,
        lat: lat,
        lon: lon,
        guessLat: null,
        guessLon: null
      });

      res.render("play", {
        image: image,
        latitude: lat,
        longitude: lon,
        api_url: process.env.API_URL
      });
    }
  } catch (e) {
    console.error(e);
  }
  finally {
    await client.close();
  }

});

app.get("/history", requiresAuth(), async (req, res) => {
  const uri = process.env.DATABASE_URI;
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const cursor = client.db("photoguesser_games").collection("game_info").find(
                        {
                            user: req.oidc.user.sub,
                            current: false
                        }
                    );
    let games = await cursor.toArray();
    games.reverse();

    const degreesToRadians = (degrees) => {
      return degrees * Math.PI / 180;
    }

    const distanceInKmBetweenEarthCoordinates = (lat1, lon1, lat2, lon2) => {
      var earthRadiusKm = 6371;

      var dLat = degreesToRadians(lat2-lat1);
      var dLon = degreesToRadians(lon2-lon1);

      lat1 = degreesToRadians(lat1);
      lat2 = degreesToRadians(lat2);

      var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
      var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return earthRadiusKm * c;
    }

    games.forEach(game => {
      game.distance = Math.round(distanceInKmBetweenEarthCoordinates(game.lat, game.lon, game.guessLat, game.guessLon) * 100) / 100;
    });

    res.render("history", {
      games: games
    });
  } catch (e) {
    console.error(e);
  }
  finally {
    await client.close();
  }
});

app.post("/guess", async (req, res) => {
  const uri = process.env.DATABASE_URI;
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const update = await client.db("photoguesser_games").collection("game_info")
                         .updateOne({ user: req.oidc.user.sub, current: true }, { $set: {
                           current: false,
                           guessLat: req.body.lat,
                           guessLon: req.body.lng
                         }});
  } catch (e) {
    console.error(e);
  }
  finally {
    await client.close();
  }


});

app.listen(3000);
