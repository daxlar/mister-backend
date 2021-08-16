const express = require("express");
const cors = require("cors");
const AWS = require("aws-sdk");
const { DevOpsGuru } = require("aws-sdk");

const app = express();

AWS.config.update({
  region: "us-west-2",
  endpoint: "https://dynamodb.us-west-2.amazonaws.com",
});

let dynamodb = new AWS.DynamoDB();
let docClient = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = "ScheduledRooms";
const PRIMARY_KEY = "Room";
const SECONDARY_KEY = "Assigned";

let params = {
  TableName: TABLE_NAME,
  KeySchema: [
    { AttributeName: PRIMARY_KEY, KeyType: "HASH" },
    { AttributeName: SECONDARY_KEY, KeyType: "RANGE" },
  ],
  AttributeDefinitions: [
    { AttributeName: PRIMARY_KEY, AttributeType: "S" },
    { AttributeName: SECONDARY_KEY, AttributeType: "S" },
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 10,
    WriteCapacityUnits: 10,
  },
};

dynamodb.createTable(params, function (err, data) {
  if (err) {
    console.error(
      "Unable to create table. Error JSON:",
      JSON.stringify(err, null, 2)
    );
  } else {
    console.log(
      "Created table. Table description JSON:",
      JSON.stringify(data, null, 2)
    );
  }
});
/*
let scanParams = {
  TableName: "Movies",
  FilterExpression: "#start between :start_yr and :end_yr",
  ExpressionAttributeNames: {
    "#yr": "StartingTime",
  },
  ExpressionAttributeValues: {
    ":start_yr": "2021-08-14",
    ":end_yr": "2021-08-16",
  },
};
*/

/*

docClient.scan(params, onScan);

function onScan(err, data) {
  if (err) {
    console.error(
      "Unable to scan the table. Error JSON:",
      JSON.stringify(err, null, 2)
    );
  } else {
    // print all the movies
    console.log("Scan succeeded.");
    data.Items.forEach(function (movie) {
      console.log(movie.Room, movie.StartingTime);
    });
    // continue scanning if we have more movies, because
    // scan can retrieve a maximum of 1MB of data
    if (typeof data.LastEvaluatedKey != "undefined") {
      console.log("Scanning for more...");
      params.ExclusiveStartKey = data.LastEvaluatedKey;
      docClient.scan(params, onScan);
    }
    
  }
}
*/

let putParams = {
  TableName: TABLE_NAME,
  Item: {
    Room: "1",
    Assigned: "2021-08-15",
    StartingTime: 1380,
    EndingTime: 1410,
  },
};

docClient.put(putParams, function (err, data) {
  if (err) {
    console.error("Unable to add time", JSON.stringify(err, null, 2));
  } else {
    console.log("PutItem succeeded:");
  }
});

app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("hello world");
});

/*

  Logic:
    -> (TODO): serverside validation if meeting duration + startTime < endTime!
    -> (TODO): serverside validation that minimum meeting duration is 15min
    -> Look in database to see all conflicting times
      -> filter Query params by:
          -> endTimeClient < endTimeServer && endTimeClient > startTimeServer
          -> startTimeClient > startTimeServer && startTimeClient < endTimeServer
          -> startTimeClinet > startTimeServer && endTimeClient < endTimeServer
          -> meetingDateClient == meetingDateServer
    -> Sort the conflicting times by earliest to latest
    -> Build the available list of times in JSON
    -> Send JSON back to front-end

    -> Have the front-end display all the available times
    -> After choosing the time, server side validation if it was successful
    -> Log the time in database.

  */

app.post("/", (req, res) => {
  res.send("ack");
  console.log(req.body);
  console.log(req.body.meetingDate);

  let meetingDate = req.body.meetingDate;
  let startTimeRange = Number(req.body.meetingStartRangeInMinutes);
  let endTimeRange = Number(req.body.meetingEndRangeInMinutes);
  let durationMinutes =
    Number(req.body.meetingDurationMinutes) +
    Number(req.body.meetingDurationHoursInMinutes);

  /*
  Build all the possible meeting intervals
  */

  let meetingIntervals = [];
  for (
    let i = startTimeRange;
    i + durationMinutes <= endTimeRange;
    i += durationMinutes
  ) {
    let interval = {
      meetingStartTime: startTimeRange,
      meetingEndTime: startTimeRange + durationMinutes,
    };
    meetingIntervals.push(interval);
  }

  /*
  Build a query param for each of the possible intervals
  */

  let scanParams = [];
  for (let i = 0; i < meetingIntervals.length; i++) {
    let scanParam = {
      TableName: TABLE_NAME,
      FilterExpression:
        "(#date = :meeting_date) and " +
        "(#start > :start_time and #start < :end_time) and " +
        "(#end > :start_time and #end < :end_time) and " +
        "(#start >= :start_time and #end <= :end_time)",
      ExpressionAttributeNames: {
        "#date": SECONDARY_KEY,
        "#start": "StartingTime",
        "#end": "EndingTime",
      },
      ExpressionAttributeValues: {
        ":meeting_date": meetingDate,
        ":start_time": meetingIntervals[i].meetingStartTime,
        ":end_time": meetingIntervals[i].meetingEndTime,
      },
    };

    scanParams.push(scanParam);
  }

  /*
  Query the database for each scanParam and build the conflicting times array
  */

  let conflictIntervals = [];
  for (let i = 0; i < scanParams.length; i++) {
    docClient.scan(params, (err, data) => {
      if (err) {
        console.error(
          "Unable to scan the table. Error JSON:",
          JSON.stringify(err, null, 2)
        );
      } else {
        // print all the movies
        console.log("Scan succeeded.");
        data.Items.forEach(function (meeting) {
          console.log(meeting);
          conflictIntervals.push(meeting);
          console.log(conflictIntervals);
        });
        /*
        // continue scanning if we have more movies, because
        // scan can retrieve a maximum of 1MB of data
        if (typeof data.LastEvaluatedKey != "undefined") {
          console.log("Scanning for more...");
          params.ExclusiveStartKey = data.LastEvaluatedKey;
          docClient.scan(params, onScan);
        }
        */
      }
    });
  }

  /*
  let params = {
    TableName: "ScheduledRooms",
    Item: {
      Room: "1",
      Assigned: req.body.meetingDate,
      StartingTime: req.body.meetingDate,
    },
  };

  docClient.put(params, function (err, data) {
    if (err) {
      console.error("Unable to add time", JSON.stringify(err, null, 2));
    } else {
      console.log("PutItem succeeded:");
    }
  });
  */
});

app.listen(5000, () => {
  console.log("server is listening on port 5000");
});
