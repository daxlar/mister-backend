const express = require("express");
const cors = require("cors");
const AWS = require("aws-sdk");

const app = express();

AWS.config.dynamodb = {
  region: "us-west-2",
  endpoint: "https://dynamodb.us-west-2.amazonaws.com",
};

AWS.config.iotdata = {
  region: "us-west-2",
  endpoint: "a36ozlrpzvmdr4-ats.iot.us-west-2.amazonaws.com",
};

let dynamodb = new AWS.DynamoDB();
let docClient = new AWS.DynamoDB.DocumentClient();
let iotdata = new AWS.IotData();

const TABLE_NAME = "ScheduledRooms";
const PRIMARY_KEY = "Room";
const SECONDARY_KEY = "Assigned";
const NUM_ROOMS = 2;
const ROOM_INDEX_START = 1;
const MINIMUM_INTERVAL_TIME = 15;

const createRandomFiveDigit = () => {
  return Math.floor(Math.random() * 90000) + 10000;
};

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
    -> (TODO): serverside validation that a meeting was successfully taken
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
  if (startTimeRange % MINIMUM_INTERVAL_TIME != 0) {
    let segment = Math.floor(startTimeRange / MINIMUM_INTERVAL_TIME) + 1;
    startTimeRange = segment * MINIMUM_INTERVAL_TIME;
  }

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
      const result = await docClient.scan(scanParams[i]).promise();
      let unavailableRoomNumbers = new Map();
      result.Items.forEach(function (meeting) {
        unavailableRoomNumbers.set(Number(meeting.Room), true);
      });

      for (let j = ROOM_INDEX_START; j <= NUM_ROOMS; j++) {
        if (unavailableRoomNumbers.has(j) === true) {
          continue;
        }
        let meetingIntervalClone = Object.assign({}, meetingIntervals[i]);
        meetingIntervalClone.meetingDate = meetingDate;
        meetingIntervalClone.roomNumber = j;
        availableIntervals.push(meetingIntervalClone);
      }
    }
    res.send(availableIntervals);
  }

  queryDBAndUpdateUI();
});

app.put("/", (req, res) => {
  let putParams = {
    TableName: TABLE_NAME,
    Item: {
      Room: String(req.body.roomNumber),
      Assigned: req.body.meetingDate + "-" + createRandomFiveDigit(),
      StartingTime: Number(req.body.meetingStartTime),
      EndingTime: Number(req.body.meetingEndTime),
    },
  };

  const core2IoTPayload = {
    state: {
      desired: { meetingInterval: "0000-0000", acknowledgement: false },
    },
  };

  let meetingStart = req.body.meetingStartTime.toString().padStart(4, "0");
  let meetingEnd = req.body.meetingEndTime.toString().padStart(4, "0");

  core2IoTPayload.state.desired.meetingInterval =
    meetingStart + "-" + meetingEnd;

  let shadowParams = {
    payload: JSON.stringify(core2IoTPayload),
    thingName: "01231bd1cbac971101" /* required */,
  };

  // TODO: ATTACH REQUEST TIME TO SHADOW
  // MAKE SURE SHADOW IS ONLY BEING UPDATED FOR UPCOMING MEETING!

  iotdata.updateThingShadow(shadowParams, function (err, data) {
    if (err) {
      console.error("Unable to send to core2", JSON.stringify(err, null, 2));
    } else {
      console.log("send to core2 succeeded:");
    }
  });

  docClient.put(putParams, function (err, data) {
    if (err) {
      res.send(JSON.stringify("error"));
    } else {
      res.send(JSON.stringify("success"));
    }
  });
});

app.listen(5000, () => {
  console.log("server is listening on port 5000");
});
