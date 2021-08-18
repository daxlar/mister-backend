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
const RANDOM_NUMBER = Math.floor(Math.random() * 90000) + 10000;
const NUM_ROOMS = 2;
const ROOM_INDEX_START = 1;

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

let putParams = {
  TableName: TABLE_NAME,
  Item: {
    Room: "1",
    Assigned: "20210815" + "-" + RANDOM_NUMBER,
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
    -> (TODO): using random number in key to create separate entries might override entry
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
      meetingStartTime: i,
      meetingEndTime: i + durationMinutes,
    };
    meetingIntervals.push(interval);
  }

  console.log(meetingIntervals);
  /*
  Build a query param for each of the possible intervals
  */

  let scanParams = [];
  for (let i = 0; i < meetingIntervals.length; i++) {
    let scanParam = {
      TableName: TABLE_NAME,
      FilterExpression:
        "(#date BETWEEN :meeting_date_lower AND :meeting_date_upper) AND (" +
        "(#start > :start_time AND #start < :end_time) OR " +
        "(#end  > :start_time AND #end < :end_time) OR " +
        "(#start >= :start_time AND #end <= :end_time ))",
      ExpressionAttributeNames: {
        "#date": SECONDARY_KEY,
        "#start": "StartingTime",
        "#end": "EndingTime",
      },
      ExpressionAttributeValues: {
        ":meeting_date_lower": meetingDate + "-00000",
        ":meeting_date_upper": meetingDate + "-99999",
        ":start_time": meetingIntervals[i].meetingStartTime,
        ":end_time": meetingIntervals[i].meetingEndTime,
      },
    };

    scanParams.push(scanParam);
  }

  /*
  Query the database for each scanParam and build the conflicting times array
  */

  let availableIntervals = [];

  async function queryDBAndUpdateUI() {
    for (let i = 0; i < scanParams.length; i++) {
      console.log(scanParams[i]);
      const result = await docClient.scan(scanParams[i]).promise();
      console.log("getting result:");
      console.log(result.Items);
      console.log("finished getting result");

      let unavailableRoomNumbers = new Map();
      result.Items.forEach(function (meeting) {
        unavailableRoomNumbers.set(Number(meeting.Room), true);
        console.log("set:");
        console.log(meeting.Room);
      });

      console.log("unavailable rooms:");
      console.log(unavailableRoomNumbers);

      for (let j = ROOM_INDEX_START; j <= NUM_ROOMS; j++) {
        if (unavailableRoomNumbers.has(j) === true) {
          continue;
        }
        let meetingIntervalClone = Object.assign({}, meetingIntervals[i]);
        meetingIntervalClone.meetingDate = meetingDate;
        meetingIntervalClone.roomNumber = j;
        availableIntervals.push(meetingIntervalClone);
        console.log("pushed: ");
        console.log(j);
      }
    }
    console.log("finished all db reads");
    console.log(availableIntervals);

    console.log(JSON.stringify(availableIntervals));
    //res.json("hello from the back end");
    res.send(availableIntervals);
  }

  queryDBAndUpdateUI();

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
