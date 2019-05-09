/**
 * restCtrl.js
 *
 * 3/6/2019
 * CS160 - ODFDS Project
 * Restaurant controller that handles all the post requests
 * from the front-end side for restaurnat users.
 */

const conn = require('./dbCtrl'); // Connection to the database.
const socketApi = require('./socketApi'); // Connection to socekt API.
const googleMap = require('./googleMapApi'); // Connection to Google Map API.
const pricePerMile = 2; // Charge $2 per mile.
const pricePerMinute = .5; // Charge $0.5 per minute.

/** Gets request page with restaurant information. */
module.exports.request = function (req, res) {
  // Find current user's geo location information.
  var sql = 'SELECT Latitude, Longitude FROM Restaurant r, \
               Location l WHERE uID = ? AND r.LocationID = l.LocationID;';
  var value = [req.session.uID]; // get current logged-in user's uID
  conn.query(sql, value, function (err, result) {
    if (err) { return res.render('error', {msg:'Getting Address Failed'}); }
    res.render('requestPage', { start:req.session.rAddr, rID:req.session.rID,
                                lat:result[0].Latitude, lng:result[0].Longitude });
  });
}

/**
 * Posts request page.
 * - Calculates and validates a delivery route
 * - Sends the route information to the restaurant user.
 * - Finds the nearest available driver.
 * - Sends the route info to the driver.
 */
module.exports.orderRequest = function (req, res) {
  const rID = req.session.rID;
  const rName = req.session.rName;
  const rAddr = req.session.rAddr;
  const dest = req.body.destination;
  // Holds route information.
  var OrderInfo = function(dist, time, price) {
    this.dist = dist;
    this.time = time;
    this.price = price;
  };
  // Holds the nearest driver information.
  var DriverInfo = function(dID, dName, dPhone, dist, time) {
    this.id = dID;
    this.name = dName;
    this.phone = dPhone;
    this.distToRest = dist;
    this.timeToRest = time;
  };
  var distances = {}; // Holds available drivers with distances to the restaurant.
  // Calculate the route from the restaurant location to the destination.
  googleMap.calcRoute(rAddr, dest, routeInfo);
  /**
   * Calculates the order price based on the distance and duration,
   * saves the order inforamtion and sends to the restaurant user.
   * If the order is not valid, sends an error message,
   * otherwise, it will continue to find available drivers.
   * @param {string} distance distance from restaurnt to destination
   * @param {string} duration delivery duration
   */
  function routeInfo(distance, duration) {
      var price = (parseFloat(distance) * pricePerMile + parseFloat(duration) * pricePerMinute).toFixed(2);
      // If order is not valid, send error message to the restaurant user.
      if (price < 6 || parseFloat(duration) > 30) {
        var err = "Order can't be made: \
                   we can't take order less than $6 or taking more than 30min.";
        socketApi.sendMsg(err);
      } else {
        // If first order, first 1 mile is free.
        sql = 'SELECT * FROM Delivery WHERE rID = ?;';
        conn.query(sql, rID, function (err, results) {
          if (err) { console.log("routeInfo: db connection failed."); }
          else {
            if (results.length == 0){
              price -= pricePerMile;
              socketApi.sendMsg('You got free 1 mile for the first order!');
            }
          }
        });
        var orderInfo = new OrderInfo(distance, duration, price);
        // Send route information to the restaurant user.
        socketApi.sendRouteInfo(rID, rName, rAddr, dest, orderInfo, null, res);
        // If order is valid, find available drivers.
        findDrivers(orderInfo);
      }
  }
  /**
   * Finds all available drivers and
   * loops each driver to find the nearest one.
   * @param {Object} orderInfo order information
   */
  function findDrivers(orderInfo) {
    var drivers1 = [];
    // Find drivers who's working on their 1st delievery from the same restaurnat.
    var sql1 = "select d.driverID, d.Name, d.Phone, Latitude, Longitude, Price \
                from Driver d, Restaurant r, Delivery del, Location l, Price p \
                where Working = 1 and Notification = 'ON' AND del.driverID = d.driverID \
                AND del.rID = r.rID AND l.LocationID = d.LocationID AND r.Address = ? \
                AND del.Status = 'Incomplete' AND p.orderID = del.orderID;";

    conn.query(sql1, rAddr, function (err, wDrivers) {
      if (err) { console.log("findDrivers: sql1 failed."); }
      // If result is not 0, go over each working driver to
      // see if they matches with the price restriction.
      else {
        if (wDrivers.length > 0) {
          for (const driver of wDrivers) {
            // current order price < previous order price
            console.log(wDrivers);
            if (driver.Price > orderInfo.price) {
              drivers1.push(driver);
            }
          }
        }
      }
    });
    console.log(drivers1);
    // Find all available drivers who are not working.
    var sql2 = 'SELECT driverID, Name, Phone, Latitude, Longitude FROM Driver d, \
                Location lo WHERE Working = 0 and Notification = \'ON\' AND \
                d.LocationID = lo.LocationID;';

    conn.query(sql2, function (err, drivers2) {
       // For each available driver, covert lat/lng to address and find nearest driver.
      if (err) {
        console.log("findDrivers: sql2 failed.");

      } else {
        drivers = drivers1.concat(drivers2);
        //console.log(drivers);
         for (const driver of drivers) {
          // Logs information on the driver.
           findNearest(drivers, driver, orderInfo);
         }
      }
    });
  }
  /**
   * Converts driver's geo location to address,
   * calculates distance/duration from that address to the restaurnt,
   * if it's last driver to calculate, find the nearest one,
   * and sends the order information to the nearest driver found.
   * @param {Object} drivers all available drives
   * @param {Object} driver driver to calculate distance/duration to the restaurnt
   * @param {Object} orderInfo order information
   */
  function findNearest(drivers, driver, orderInfo) {
    // Convert driver's current latitude and longitude into address.
    googleMap.mapClient.reverseGeocode({latlng: [driver.Latitude, driver.Longitude]
       }, function(err, res) {
          if (!err) {
            var dAddr = res.json.results[0].formatted_address; // Converted address.
            /**
             * Saves current driver info and finds the nearest driver.
             * @param {string} distance distance from driver to restaurnt
             * @param {string} duration duration from driver to restaurnt
             */
            var nearestDriver = function (distance, duration) {
              // Save current driver information to the object of all drivers.
              distances[driver.driverID] = [driver.Name, driver.Phone, distance, duration];
              // Find the nearest driver.
              if (drivers.length == Object.keys(distances).length) {
                console.log("findNearest:", distances);
                var minID, minDistance = 99999;
                for (key in distances) {
                  if (minDistance > parseFloat(distances[key][2])) {
                    minID = key;
                    minDistance = parseFloat(distances[key][2]);
                  }
                }
                // Save the nearest driver info.
                var driverInfo = new DriverInfo(minID, distances[minID][0], distances[minID][1],
                  distances[minID][2], distances[minID][3]);
                // Print the restaurant and the nearest driver info.
                console.log(rID, rAddr, driverInfo.id, driverInfo.name,
                  driverInfo.phone, driverInfo.distToRest, driverInfo.timeToRest);
                // Send route information to the corresponding driver.
                socketApi.sendRouteInfo(rID, rName, rAddr, dest, orderInfo, driverInfo, res);
              }
            }
            // Caluclate distance/duration from driver to restaurnt.
            googleMap.calcRoute(dAddr, rAddr, nearestDriver);
        }
    });
  }
}

/**
 * Saves order information into
 * Delivery and Price tables in the database,
 * and sends order ID information to the user.
 */
module.exports.saveOrder = function (rID, dID, dest, dist, duration, price) {
  var today = new Date();
  var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
  var time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
  // Save delivery information to Delivery table in the database.
  var sql = 'INSERT INTO Delivery (rID, driverID, startTime, Date, Destination) \
             VALUE(?, ?, ?, ?, ?);';
  var value = [rID, dID, time, date, dest];
  conn.query(sql, value, function (err, result) {
    if (err) { console.log('Inserting to Delivery Failed..'); }
    else {
      console.log('Inserting delivery info into the db done successfully.');
      socketApi.sendOrderID(result.insertId, dID); // Send order ID to both users.
      savePrice(result.insertId); // Save price infomration.
      changeDriverLoc(rID, dID);
    }
  });
  /**
   * Once driver accepts order, his current location will
   * be changed to the restaurant location.
   * @param {string} rID restaurant ID
   * @param {string} dID driver ID
   */
  function changeDriverLoc(rID, dID) {
    // Gets restaurant's geo location information.
    sql = 'SELECT r.LocationID, Latitude, Longitude FROM Location l, Restaurant r \
           WHERE r.rID = ? AND r.LocationID = l.LocationID;';
    conn.query(sql, rID, function(err, location) {
      if (err) { console.log('DB connection Failed (changeDriverLoc)..'); }
      else {
        // Change driver's current location to the restaurant address.
        sql = 'UPDATE Driver SET LocationID = ? WHERE driverID = ?;';
        value = [location[0].LocationID, dID];
        conn.query(sql, value, function(err, result) {
          if (err) { console.log("Updating Driver's location failed..."); }
          else {
            console.log("Driver's location changed to Restaurant Address.");
          }
        });
      }
    });
  }
  /**
   * Saves price information to the Price table in the database.
   * @param {string} orderID order ID created from the Delivery table.
   */
  function savePrice(orderID) {
    sql = 'INSERT INTO Price (orderID, totalDistance, totalTime, Price) \
           VALUE(?, ?, ?, ?);';
    value = [orderID, parseFloat(dist), parseFloat(duration), parseFloat(price)];
    conn.query(sql, value, function (err, result) {
      if (err) { console.log('Inserting to Price table Failed..'); }
      else {
        console.log('Inserting to Price table done successfully.');
      }
    });
  }
}

/** Gets tracking information by the oder ID. */
module.exports.getTrackInfo = function (req, res) {
  const orderId = req.body.orderId;
  var sql = 'SELECT dr.driverID, d.orderID, Address, Destination, Latitude, Longitude, \
             totalDistance, totalTime, Price, d.Status FROM Delivery d, Restaurant r, \
             Price p, Location l, Driver dr where d.orderID = ? and \
             d.orderID = p.orderID and d.rID = r.rID and dr.driverID = d.driverID \
             and l.LocationID = dr.LocationID;';
  const value = [orderId];
  conn.query(sql, value, function (err, result) {
    // If you are unable to find the order, re-render the page with an error message.
    if (err) {
      console.log("getTrackInfo:Finding tracking info failed...");
    } else if (result.length == 0) {
      res.render('trackPage', {message: "** Invalid order ID **"});
    } else if (result[0].Status == "Complete") {
      res.render('trackPage', {message: "The order is already completed!"});
    } else {
      res.render('trackPage', {orderId: result[0].orderID,
                                dID: result[0].driverID,
                                rAddr: result[0].Address,
                                dest: result[0].Destination,
                                dist: result[0].totalDistance,
                                time: result[0].totalTime,
                                price: result[0].Price,
                                lat: result[0].Latitude,
                                lng: result[0].Longitude });
    }
  });
}

module.exports.getOrderHistory = function (req, res) {
  var connects = [];
  if (req.session.loggedIn) {
    console.log('uID: ----', req.session.uID);

    // Check for any orders that the restaurant has.
    const sql = 'select orderID \
                from Delivery \
                Where rID in (Select rID from Restaurant Where uID = ?)'
    const value = [req.session.uID];
    conn.query(sql, value, function(err, result) {
      if (err || result.length == 0) {
        console.log("no orders Logged yet.");
        res.render('rHistory');
      }
      else {
        for (i = 0; i < result.length; i++) {
          console.log("orderID: ", result[i]);
          const sql2 = 'select d.orderId, dr.Name AS dName, r.Name, dr.Phone, Destination, totalTime, price, d.Status AS stat\
                        from Restaurant r, Delivery d, Price p, Driver dr \
                        where d.orderId = ? and d.rId = r.rId and d.orderId = p.orderId and d.driverID = dr.driverID'
          const ids = [result[i].orderID];
          conn.query(sql2, ids, function(err, result2) {
            if (err || result2.length ==0) {
              console.log(err);
              res.render('rHistory');
            }
            else {
              console.log(result2);
              connects.push(JSON.stringify(result2));
              if (connects.length != result.length) {
                console.log("not Done");
              }
              else {
                console.log('done');
                res.render('rHistory', {query: connects});
              }
            }
          })
        }
      }
    })
  }
}

/*      #################################################### START WORKING HERE #################################   */

/**
 * Gets restaurnt user information from the user,
 * validates the user info, and saves information
 * to User/Location/Restaurant tables.
 * It will also geocode the address to save into the Location table.
 */
module.exports.addUser = function (req, res) {
  // Get user information from the restuarnt signup page.
  const email = req.body.email;
  const pwd = req.body.pwd;
  const rPwd = req.body.repeatpwd;
  const name = req.body.name;
  const addr  = req.body.address;
  const phone  = req.body.phone;
  const creditCard = req.body.creditCard;
  // Insert data into tables;
  var sql, value;
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
        res.render('restaurantSignup', {errorM: errorMessage});
        return;
      }
      else {    // Email is not present in the db; therefore check if passes the requirements.

      if (email.length == 0) {
      console.log('Email is non inputed');
      errorMessage = "Please input email";
      res.render('restaurantSignup', {errorM: errorMessage});
      return;
    }
    else if (!email.includes("@") || !email.includes(".com")) {
      console.log("not a valid email");
      errorMessage = "Enter a VALID email.";
      res.render('restaurantSignup', {errorM: errorMessage });
      return;
    }
    else {
     console.log("Email is Verified; proceed to the other fields");
     validateEntries();
    }
  }})
}


    /**
      This method will be responsible for validating the entries

    **/
    function validateEntries() {
    // Password Checking
    if (pwd.length < 4) {
      console.log("Invalid Pasword \n");
      if (pwd.length == 0) {
        errorMessage = "Please input password";
        res.render('restaurantSignup', {errorM: errorMessage });
        return;
      }
      else {
        errorMessage = "Error: Password must be at least 4 characters";
        res.render('restaurantSignup', {errorM: errorMessage });
        return;
      }

    }
    else {
      if (rPwd.length == 0) {
        console.log("Password is not verified. \n");
        errorMessage = "Error: Re type your password for verification.";
        res.render('restaurantSignup', {errorM: errorMessage });
        return;
      }
      else if (pwd != rPwd) {
        console.log("Passwords do NOT match. \n");
        errorMessage = "Passwords do not match.";
        res.render('restaurantSignup', {errorM: errorMessage});
        return;
      }
    }


    // Checkpoint in console.
    console.log("Password Verified");

    if (name.length == 0) {
      console.log("Name not inputted \n");
      errorMessage = "Enter a name.";
      res.render('restaurantSignup', {errorM: errorMessage});
      return;
    }

    // Checkpoint.
    console.log("Name is Verified \n");


    /*          ################################################ License ######################################## */

    if (addr.length == 0) {
      console.log("Invalid license ID. \n");
      errorMessage = "Enter a valid Address (Ex: 1 Washington Square)";
      res.render('restaurantSignup', {errorM: errorMessage });
      return;
    }



    if (phone.length == 0 || phone.length != 10) {
      console.log("Invalid phone number. \n");
      errorMessage = "Enter a valid Phone number: (1234567890)";
      res.render('restaurantSignup', {errorM: errorMessage });
      return;
    }
    else {
      console.log("Phone is good.");
    }

    if (creditCard.length == 0 || creditCard.length != 16) {
      console.log("no bank input \n");
      errorMessage = "Credit Card must be 16 digits long.";
      res.render('restaurantSignup', {errorM: errorMessage });
      return;
    }
    else {
      console.log("Bank is Validated");
    }

     addUserInfo();
    }


  /**
   * Insert user information into User table.
   */
  function addUserInfo() {
    sql = 'INSERT into User (Email, Password, Type) VALUE(?, ?, ?);';
    value = [email, pwd, 'Restaurant'];
    conn.query(sql, value, function (err, result) {
      if (err) { console.log('Inserting to User Failed'); }
      else     { addLocation(result.insertId); }
    })
  }
  /**
   * Converts address to latitude and longitude and
   * inserts location information into Location table.
   * @param {integer} userId auto-generated user ID
   */
  function addLocation(userId) {
    sql = 'INSERT INTO Location (Latitude, Longitude) VALUE(?, ?);';
    // Convert address into latitude and Longitude
    googleMap.mapClient.geocode({address: addr}, function(err, response) {
       if (!err) {
         const lat = response.json.results[0].geometry.location.lat;
         const lng = response.json.results[0].geometry.location.lng;
         const value = [lat, lng];
         conn.query(sql, value, function (err, result) {
           if (err) { console.log('Inserting to Location Failed'); }
           else     { addRestaurant(userId, result.insertId); }
         })
       }
     });
  }
  /**
   * Inserts restuarnt info into Restaurant table
   * and rends the main page.
   * @param {integer} userId auto-generated user ID
   * @param {integer} locId auto-generated location ID
   */
  function addRestaurant(userId, locId) {
    sql = 'INSERT INTO Restaurant (uId, Name, Address, LocationID, \
                    Phone, CreditCard) VALUE(?, ?, ?, ?, ?, ?);';
    value = [userId, name, addr, locId, phone, creditCard];
    conn.query(sql, value, function (err, result) {
      if (err) { console.log('Inserting to Restaurant Failed'); }
      else {
        console.log('\nInserting user info into the db done successfully.\n');
        return res.redirect('/');
      }
    })
  }
}
