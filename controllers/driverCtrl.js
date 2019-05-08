/**
 * driverCtrl.js
 *
 * 3/6/2019
 * CS160 - ODFDS Project
 * Driver controller that handles all the post requests
 * from the front-end side for driver users.
 */

const conn = require('./dbCtrl'); // Connection to the database.
const socketApi = require('./socketApi');
const googleMap = require('./googleMapApi');

/** Updates delivery end time when order is completed. */
module.exports.updateEndTime = function (orderID, endTime) {
  var sql = 'UPDATE Delivery SET endTime = ? WHERE orderID = ?;';
  var value = [endTime, orderID];
  conn.query(sql, value, function(err, result) {
    if (err) { console.log('Updating order time failed.'); }
    else { console.log('updateEndTime: successful'); }
  });
}

/** Updates order status when order compeleted. */
module.exports.updateOrderStatus = function (orderID) {
  var sql = 'UPDATE Delivery SET Status = "Complete" WHERE orderID = ?;';
  var value = [orderID];
  conn.query(sql, value, function(err, result) {
    if (err) { console.log('Updating order status failed.'); }
    else { console.log('updateOrderStatus: successful'); }
  });
}

/** Updates Working variable when driver accepts/compelets order. */
module.exports.updateWorking = function (dID, change) {
  var sql = 'UPDATE Driver SET Working = ' + change + ' WHERE driverID = ?;';
  var value = [dID];
  conn.query(sql, value, function(err, result) {
    if (err) { console.log('Updating Working variable failed.'); }
    else { console.log('updateWorking: successful'); }
  });
}

/** Updates driver's Notification setting to ON or OFF. */
module.exports.updateNotification = function (dID, onOff) {
  var sql = 'UPDATE Driver SET Notification = ? WHERE driverID = ?;';
  var value = [onOff, dID];
  conn.query(sql, value, function(err, result) {
    if (err) { console.log('Updating notification failed.'); }
    else { console.log('updateNotifiaction: successful'); }
  });
}

module.exports.trackRoute = function (lat, lng, destination) {
  console.log("trackRoute");
  googleMap.mapClient.reverseGeocode({latlng: [lat, lng]
     }, function(err, res) {
        if (!err) {
          //console.log("trackRoute: reverse geocoded successfully.");
          var dAddr = res.json.results[0].formatted_address; // Converted address.
          // Sends distance and duration to the user.
          var route = function (distance, duration) {
            //console.log("trackRoute: route - ", distance, duration);
            socketApi.trackRouteInfo(distance, duration);
          }
          // Caluclate distance/duration from driver to the destination.
          googleMap.calcRoute(dAddr, destination, route);
      }
  });
}

/**
 * Update driver's current location.
 * @param {string} dID driver ID
 * @param {string} lat driver's current latitude
 * @param {string} lng driver's current longitude
 */
module.exports.updateLocation = function(dID, lat, lng) {
  // New location info added to the Location table.
  var sql = 'INSERT into Location (Latitude, Longitude) VALUE(?, ?);';
  var value = [lat, lng];
  conn.query(sql, value, function (err, result) {
    if (err) { console.log("Inserting to Location Failed."); }
    else {
      // Update driver's location ID.
      sql = 'UPDATE Driver SET LocationID = ? WHERE driverID = ?;';
      value = [result.insertId, dID];
      conn.query(sql, value, function (err, res) {
        if (err) { console.log("Updating driver location failed"); }
        else { console.log("Driver's current location updated."); }
      });
    }
  });
}

/** Gets delivery information by the oder ID. */
module.exports.getDeliveryInfo = function (req, res) {
  const orderId = req.body.orderId;
  const sql = 'select d.orderID, Name, Address, Destination, totalDistance, \
               totalTime, Price, d.Status from Delivery d, Restaurant r, Price p \
               where d.orderID = ? and d.orderID = p.orderID and d.rID = r.rID;';
  var value = [orderId]
  conn.query(sql, value, function (err, result) {
    if (err || result.length == 0)
    {
      console.log("Couldn't find!");
      res.render('deliverInfo', {message: "** Invalid order ID **"});
    }
    else {
    console.log(result, '\n', result.orderId);
    res.render('deliverInfo', {'orderId': result[0].orderID, 'status': result[0].Status,
                               'rName': result[0].Name, 'rAddr': result[0].Address,
                               'dest': result[0].Destination, 'time': result[0].totalTime,
                               'dist': result[0].totalDistance,
                               'price': result[0].Price});
    }
  });
}

module.exports.getOrderHistory = function (req, res) {
  // If the user is logged into the website.

  var connects = [];
  if (req.session.loggedIn) {
    console.log('uID: ----', req.session.uID);

    // Checks for any orders from the current driver profile.
    const sql = 'select orderID \
                from Delivery \
                Where driverID in (Select driverID from Driver Where uID = ?)'
    const value = [req.session.uID];
    conn.query(sql, value, function (err, result) {
      if (err || result.length == 0) {
        console.log("no orders Logged yet.");
        res.render('dHistory');
      }
      else {    // Orders are currently logged for the user.
        for (i = 0; i < result.length; i++) {
          console.log('orderID: ', result[i]);

          // Changed sql2
          const sql2 = 'select d.orderId, Name, Address, Destination, totalTime, totalDistance, d.Status AS stat, price \
              from Restaurant r, Delivery d, \
              Price p where d.orderId = ? and d.rId = r.rId and d.orderId = p.orderId'
          const ids = [result[i].orderID];
          conn.query(sql2, ids, function (err, result2) {
            if (err || result2.length == 0) {
              console.log(err);
                res.render('dHistory');
              }
            else {
                connects.push(JSON.stringify(result2));
                console.log(result2);
                if (connects.length != result.length) {
                  console.log("not done");
                }
                else {
                  res.render('dHistory', {query: connects});
                }
              }
            })

        }
      }
    })
  }
}

/**
 * Gets driver user information from the user,
 * validates the user info, and saves information
 * to User/Driver tables.
 */
module.exports.addUser = function (req, res) {
  // Get user information from the driver signup page.
  const email = req.body.email;
  const pwd = req.body.pwd;
  // Added a repeat password variable to check if the passwords match
  const rPwd = req.body.repeatpwd;

  const name = req.body.name;
  const driverLocation = req.body.sLocation;
  const license  = req.body.dl;
  const phone  = req.body.phone;
  const bank = req.body.bank;

  const working = 0;
  // Insert data into tables;
  var sql, value;
  var error = false;
  var mEmail = false;

  validateEmail();


    /**
      This function will be responsible for checking of the email; needed to be separate from all the checks
      since it requires to check if the email exists in the DB.

      Overall functionality:
        1. Searches the DB if it exists, if so then re render the page with an error.
        2. Checks if the email is valid; if so then proceed to checking the other fields.

      Note: Done.

    **/
    function validateEmail() {


        // Email Checking; check for email in the db
    // Query for checking if the email already exists
    const eQuery = 'Select Email from User \
            where Email = ?'

    const val = [email]
    conn.query(eQuery, val, function(err, result) {
      if (err) {console.log("Error finding email");}
      else if (result.length != 0) {
        errorMessage = "Error: Email Exists";
        console.log("Email Already Exists \n");
        res.render('driverSignup', {errorM: errorMessage});
      }
      else {    // Email is not present in the db; therefore check if passes the requirements.

      if (email.length == 0) {
      console.log('Email is non inputed');
      errorMessage = "Please input email";
      res.render('driverSignup', {errorM: errorMessage});
    }
    else if (!email.includes("@") || !email.includes(".com")) {
      console.log("not a valid email");
      errorMessage = "Enter a VALID email.";
      res.render('driverSignup', {errorM: errorMessage });
    }
    else {
     console.log("Email is Verified; proceed to the other fields");
     validateEntries();
    }
  }})
}

    /**
      This method will be responsible for validatig each field in the signup page.

    **/ 
    function validateEntries() {
    // Password Checking
    if (pwd.length < 4) {
      console.log("Invalid Pasword \n");
      if (pwd.length == 0) {
        errorMessage = "Please input password";
        res.render('driverSignup', {errorM: errorMessage });
        return;
      }
      else {
        errorMessage = "Error: Password must be at least 4 characters"; 
        res.render('driverSignup', {errorM: errorMessage });
        return;
      }

    }
    else {
      if (rPwd.length == 0) {
        console.log("Password is not verified. \n");
        errorMessage = "Error: Re type your password for verification.";
        res.render('driverSignup', {errorM: errorMessage });
        return;
      }
      else if (pwd != rPwd) {
        errorMessage = "Passwords do not match.";
        res.render('driverSignup', {errorM: errorMessage});
        return;
      }
    }


    // Checkpoint in console.
    console.log("Password Verified");
  
    if (name.length == 0) {
      console.log("Name not inputted \n");
      errorMessage = "Enter a name.";
      res.render('driverSignup', {errorM: errorMessage});
      return;
    }

    // Checkpoint.
    console.log("Name is Verified \n");


    /*          ################################################ License ######################################## */

    if (license.length == 0) {
      console.log("Invalid license ID. \n");
      errorMessage = "Enter a valid Driver's License: (1234567890)";
      res.render('driverSignup', {errorM: errorMessage });
      return;
    }



    if (phone.length == 0 || phone.length != 10) {
      console.log("Invalid phone number. \n");
      errorMessage = "Enter a valid Phone number: (1234567890)";
      res.render('driverSignup', {errorM: errorMessage });
      return;
    }
    else {
      console.log("Phone is good.");
    }

    if (bank.length == 0 || bank.length != 16) {
      console.log("no bank input \n");
      errorMessage = "bank account must be 16 digits long.";
      res.render('driverSignup', {errorM: errorMessage });
      return;
    }
    else {
      console.log("Bank is Validated");
    }

     addUserInfo();
    }

  /**
   * Insert user infomration into User table.
   */
   function addUserInfo() {
     var sql = 'INSERT into User (Email, Password, Type) VALUE(?, ?, ?);';
     var value = [email, pwd, 'Driver'];
     conn.query(sql, value, function (err, result) {
       if (err) { console.log("Inserting to User Failed"); }
       else { addDriver(result.insertId); }
     })
   }

  /**
   * Inserts driver information into Driver table.
   * @param {integer} userId auto-generated user ID
   */
  function addDriver(userId) {
    sql = 'INSERT INTO Driver (uID, Name, License, Phone,BankAccount, Working, Notification, LocationID) \
           VALUE(?, ?, ?, ?, ?, ?, ?, ?);';
    value = [userId, name, license, phone, bank, working, 'OFF', 1001];
    conn.query(sql, value, function (err, result) {
      if (err) { console.log(err); }
      else {
        console.log('\nInserting user info into the db done successfully.\n');
        res.render('index');
      }
    })
  }
}