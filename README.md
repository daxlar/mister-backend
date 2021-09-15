# mister-backend

#### What is this ?

This is the corresponding back-end for the [mister-frontend](https://github.com/daxlar/mister-frontend).

#### What does mister-backend do ?

It stores the meeting time data from the front-end into a AWS DynamoDB table and communicates with the [mister device](https://github.com/daxlar/mister) via AWS IoT Core's device shadow.

#### Getting started

There are a couple of lines of code that need to be changed.

1. index.js:9 needs to be your own DynamoDB endpoint
2. index.js:14 needs to be your own IoTData endpoint
3. index.js:207 needs to be your own thing name

Follow the steps listed in the mister device repo : [mister device](https://github.com/daxlar/mister) to set up IoTData endpoint and thing name. Once done, the IAM User also needs the **AmazonDynamoDBFullAccess** policy.

Then, just run `npm start` to start up mister-backend
