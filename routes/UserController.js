let express = require('express');
let router = express.Router();
let bcrypt = require('bcryptjs');
var geoip = require('geoip-lite');
let { body, validationResult } = require('express-validator');
let _ = require('lodash');
let nodemailer = require('nodemailer');
let constants = require('../config/constants.json');
let config = require('../config/config');
var axios = require('axios');
const isDisposable = require('is-disposable-email-domain');

//libraries
let generateJwtToken = require('../libraries/generateJwtToken');
let createUsersObject = require('../libraries/createUsersObject');
let createVideosObject = require('../libraries/createVideosObject');
let authorize = require('../libraries/auth');

const async = require('async');

// models
let User = require('../models/User');
let Video = require('../models/Video');
let logger = require("../libraries/logger").Logger;
const request = require('request');
var otp,host,link;





/* Signup API */
router.post('/signUp', [
        body('email').notEmpty().withMessage(constants.emailValRequired).isEmail().withMessage(constants.emailValRequired1),
        body('password').notEmpty().withMessage(constants.pwdValRequired).isLength({ min: 8 }).withMessage(constants.pwdValRequired1)
    ],
    async function (req, res) {

        var lang = req.body.lang;
        var returnlangmsg = returnMsg(lang);

        if (req.body['gRecaptchaResponse'] === undefined || req.body['gRecaptchaResponse'] === '' || req.body['gRecaptchaResponse'] === null) {
            return res.json({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.googleCaptchaError, data: {}});
        }

        var secretKey = config.googleCaptchaSecretKey;
        var verificationUrl = config.googleCaptchaVerificationUrl + secretKey + "&response=" + req.body['gRecaptchaResponse'] + "&remoteip=" + req.connection.remoteAddress;

        await request(verificationUrl, async function(error,response,body) {

            if (error) {
                requestBody = JSON.stringify(req.body);
                logger.error(req.url,requestBody,err);
                return res.send({status: returnlangmsg.serverStatus,issuccess: constants.error, message: returnlangmsg.serverMessage, data: {}});
            }

            body = JSON.parse(body);
            // Success will be true or false depending upon captcha validation.
            if(body.success == undefined || body.success==false) {
                return res.json({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.googleCaptchaServerError, data: {}});
            }

            if(isDisposable.isDisposable(req.body.whatIWant) == true)
            {
                return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.emailInvalid, data: {}});
            }

            // Serverside Validation error
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                let reserrmsg = convertErrrmsg(errors.array(),lang);
                return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: reserrmsg, data: {}});
            } else {

                var email = req.body.email;
                if (req.body.email) {
                    let emailPattern = /\S+@\S+\.\S+/;
                    if(!emailPattern.test(req.body.email)) {
                        return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.emailInvalid, data: {}});
                    }
                    let getUser = await User.countDocuments({ email: req.body.email, isverified: 1 }).exec();
                    if (getUser > 0) {
                        return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.emailExists, data: {}});
                    } else {
                        email = req.body.email.toLowerCase();
                    }
                }

                // this will convert any number sequence into 6 character.
                otp = randomOtp();
                host = req.get('host');
                link = req.protocol + "://" + host + "/api/verify?id=" + otp;
                var html = 'Hello,<br> Please click on the link to verify your Account. <a href="' + link + '" target="_blank">Click here</a>';

                const mailmessage = {
                                    from: '"' + returnlangmsg.mailfrom1 + '"<' + config.fromEmail + '>',
                                    to: email,
                                    subject: returnlangmsg.mailsubject1,
                                    html : html
                                };
                var transporter = nodemailer.createTransport({
                    host: 'smtp.gmail.com',
                    port: 587,
                    secure: false,
                    requireTLS: true,
                    auth: {
                        user: config.authEmail,
                        pass: config.authpwd
                    }
                });

                let hashedPassword = await bcrypt.hashSync(req.body.password, 8);

                let userReqObj = {
                    name: req.body.name,
                    email: email,
                    password: req.body.password, //hashedPassword,
                    isverified: 0,
                    active: 0,
                    emailtoken: otp,
                    created_time: Math.floor(Math.floor(Date.now())/1000)
                }

                await User.findOne({ email: req.body.email }, async function (err, user) {
                    if (err) {
                        // Add Log Data
                        requestBody = JSON.stringify(req.body);
                        logger.error(req.url,requestBody,err);
                        return res.send({status: returnlangmsg.serverStatus,issuccess: constants.error, message: returnlangmsg.serverMessage, data: {}});
                    } else if (user) {
                        if (user.isverified == 0) {
                            user = await _.merge(user, userReqObj);
                            user.save();
                            const token = await generateJwtToken(user._id);
                            user.token = token;
                            user.active = 0;
                            user.emailtoken = otp;
                            const userObj = createUsersObject(user);

                            transporter.sendMail(mailmessage, function(mailerr, info) {
                                if (mailerr) {
                                    // Add Log Data
                                    requestBody = JSON.stringify(req.body);
                                    logger.error(req.url,requestBody,mailerr);
                                }
                            });

                            // send users response
                            return res.send({status: returnlangmsg.successStatus,issuccess: constants.success, message: returnlangmsg.userRegisterSuccessfully, data: userObj});
                        } else if (user.active == 0) {
                            return res.send({status: returnlangmsg.userDeactivatedStatus,issuccess: constants.error, message: returnlangmsg.userNotActive, data: {}});
                        } else {
                            return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.emailExists, data: {}});
                        }
                    } else {
                        // store users information
                        User.create(userReqObj, async function (err, user) {
                            if (err) {
                                // Add Log Data
                                requestBody = JSON.stringify(req.body);
                                logger.error(req.url,requestBody,err);
                                return res.send({status: returnlangmsg.serverStatus,issuccess: constants.error, message: returnlangmsg.serverMessage, data: {}});
                            } else {

                                const token = await generateJwtToken(user._id);
                                user.token = token;
                                const userObj = createUsersObject(user);

                                transporter.sendMail(mailmessage, function(mailerr, info) {
                                    if (mailerr) {
                                        // Add Log Data
                                        requestBody = JSON.stringify(req.body);
                                        logger.error(req.url,requestBody,mailerr);
                                    }
                                });

                                // send users response
                                return res.send({status: returnlangmsg.successStatus,issuccess: constants.success, message: returnlangmsg.userRegisterSuccessfully, data: userObj});
                            }
                        });
                    }
                });
            }


          });


    }
);




/* Login API */
router.post('/login', [
        body('email').notEmpty().withMessage(constants.emailValRequired).isEmail().withMessage(constants.emailValRequired1),
        body('password').notEmpty().withMessage(constants.pwdValRequired).isLength({ min: 8 }).withMessage(constants.pwdValRequired1)
    ], async function(req, res) {
        var lang = req.body.lang;
        var returnlangmsg = returnMsg(lang);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            let reserrmsg = convertErrrmsg(errors.array(),lang);
            return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: reserrmsg, data: {}});
        } else {

            var email = req.body.email;
            if (req.body.email) {
                let emailPattern = /\S+@\S+\.\S+/;
                if(!emailPattern.test(req.body.email)) {
                    return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.emailInvalid, data: {}});
                } else {
                    email = req.body.email.toLowerCase();
                }
            }

            User.findOne({ email: req.body.email }, async function (err, user) {
                if (err) {
                    // Add Log Data
                    requestBody = JSON.stringify(req.body);
                    logger.error(req.url,requestBody,err);
                    return res.send({status: returnlangmsg.serverStatus,issuccess: constants.error, message: returnlangmsg.serverMessage, data: {}});
                } else if (!user) {
                    return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.emailNotExists, data:{}});
                } /*else if(req.body.password != user.password) {
                    return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.passwordIncorrect, data: {}});
                }*/ else if (user.isverified == 0) {
                    return res.send({status: returnlangmsg.userDeactivatedStatus,issuccess: constants.error, message: returnlangmsg.userNotVerify, data: {}});
                } else if (user.active == 0) {
                    return res.send({status: returnlangmsg.userDeactivatedStatus,issuccess: constants.error, message: returnlangmsg.userNotActive, data: []});
                } else {
                    const token = await generateJwtToken(user._id);
                    user.token = token;
                    const userObj = createUsersObject(user);
                    // Store User Id to Session in Db
                    req.session.user = { userId : user._id, userEmail: user.email };
                    return res.send({status: returnlangmsg.successStatus,issuccess: constants.success, message: returnlangmsg.userLoggedInSuccessfully, data: userObj});
                }
            });
        }
    }
);

/* Verify User Account */
router.get('/verify', async function(req,res){
    if (req.query.id != "") {
        await User.findOne({ emailtoken: req.query.id }, async function (err, user) {
            if (err) {
                // Add Log Data
                requestBody = JSON.stringify(req.body);
                logger.error(req.url,requestBody,err);
                //return res.send({status: constants.serverStatus,issuccess: constants.error, message: constants.serverMessage, data: {}});
                return res.redirect(config.verifymail1+constants.error+config.verifymail2+'3');
                return response.end();
            } else if (!user) {
                //return res.send({status: constants.errorStatus,issuccess: constants.error, message: constants.userNotExists, data:{}});
                return res.redirect(config.verifymail1+constants.error+config.verifymail2+'2');
                return response.end();
            }
            else
            {
                if(req.query.id == user.emailtoken)
                {
                    const token = await generateJwtToken(user._id);
                    user.isverified = 1;
                    user.active = 1;
                    user.emailtoken = "";
                    user.token = token;
                    await user.save();
                    const userObj = await createUsersObject(user);
                    //return res.send({status: constants.successStatus,issuccess: constants.success, message: constants.userVerifySuccessfully, data: userObj});
                    return res.redirect(config.verifymail1+constants.success+config.verifymail2+'1');
                    return response.end();
                }
                else
                {
                    //return res.send({status: constants.serverStatus,issuccess: constants.error, message: constants.badRequest, data: {}});
                    return res.redirect(config.verifymail1+constants.error+config.verifymail2+'4');
                    return response.end();
                }
            }
        });
    }
    else
    {
        //return res.send({status: constants.serverStatus,issuccess: constants.error, message: constants.badRequest, data: {}});
        return res.redirect(config.verifymail1+constants.error+config.verifymail2+'4');
        return response.end();
    }
});

/* Logout API */
router.post('/logout', authorize, async function(req,res){
    if (!req.session.user) {
        return res.send({status: constants.serverStatus,issuccess: constants.error, message: constants.badRequest, data: {}});
    }
    else
    {
        req.session.destroy(function(err) {
            if (err) {
                // Add Log Data
                requestBody = JSON.stringify(req.body);
                logger.error(req.url,requestBody,err);
                return res.send({status: constants.serverStatus,issuccess: constants.error, message: constants.serverMessage, data: {}});
            }
            res.clearCookie(config.sessname);
            return res.send({status: constants.successStatus,issuccess: constants.success, message: "Session Destroy.", data: "Session Destroy."});
        });
    }
});

/* Check Session API */
router.post('/checksession', authorize, async function(req,res){
    if (!req.session.user) {
        return res.send({status: constants.serverStatus,issuccess: constants.error, message: constants.badRequest, data: {}});
    }
    else
    {
        return res.send({status: constants.successStatus,issuccess: constants.success, message: req.session.user, data: req.session.user});
    }
});

/* Sent 6 Digit Code on Email for Forgot Password */
router.post('/forgot-password', [
        body('email').notEmpty().withMessage(constants.emailValRequired).isEmail().withMessage(constants.emailValRequired1),
    ], async function(req,res){

        var lang = req.body.lang;
        var returnlangmsg = returnMsg(lang);

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            let reserrmsg = convertErrrmsg(errors.array(),lang);
            return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: reserrmsg, data: {}});
        } else {
            await User.findOne({ email: req.body.email }, async function (err, user) {
                if (err) {
                    // Add Log Data
                    requestBody = JSON.stringify(req.body);
                    logger.error(req.url,requestBody,err);
                    return res.send({status: returnlangmsg.serverStatus,issuccess: constants.error, message: returnlangmsg.serverMessage, data: {}});
                } else if (!user) {
                    return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.emailNotExists, data:{}});
                } else if (user.isverified == 0) {
                    return res.send({status: returnlangmsg.userDeactivatedStatus,issuccess: constants.error, message: returnlangmsg.userNotVerify, data: {}});
                } else if (user.active == 0) {
                    return res.send({status: returnlangmsg.userDeactivatedStatus,issuccess: constants.error, message: returnlangmsg.userNotActive, data: []});
                } else {

                    var email = req.body.email;
                    if (req.body.email) {
                        let emailPattern = /\S+@\S+\.\S+/;
                        if(!emailPattern.test(req.body.email)) {
                            return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.emailInvalid, data: {}});
                        } else {
                            email = req.body.email.toLowerCase();
                        }
                    }

                    // this will convert any number sequence into 6 character.
                    otp = resetpwdOtp(); //randomOtp();
                    var html = 'Hello, <br>Your verification code for password reset is : ' + otp;

                    const mailmessage = {
                                        from: '"' + returnlangmsg.mailfrom1 + '"<' + config.fromEmail + '>',
                                        to: email,
                                        subject: returnlangmsg.mailsubject2,
                                        html : html
                                    };

                    var transporter = nodemailer.createTransport({
                        host: 'smtp.gmail.com',
                        port: 587,
                        secure: false,
                        requireTLS: true,
                        auth: {
                            user: config.authEmail,
                            pass: config.authpwd
                        }
                    });

                    let valid = true;
                    await transporter.sendMail(mailmessage, function(mailerr, info) {
                        if (mailerr) {
                            valid = false;
                            // Add Log Data
                            requestBody = JSON.stringify(req.body);
                            logger.error(req.url, requestBody,mailerr);
                        }
                        else
                        {
                            valid = true;
                        }
                        return res.end();
                    });

                    if (valid == true) {
                        // emailtoken Expire Time
                        var d1 = new Date ();
                        var d2 = new Date ( d1 );
                        d2 = d2.setMinutes ( d1.getMinutes() + 10 );

                        user.emailtoken = otp;
                        user.tokenexpiretime = d2;
                        await user.save();
                        user.emailtoken = "";
                        user.tokenexpiretime = d2;
                        const userObj = createUsersObject(user);
                        return res.send({status: returnlangmsg.successStatus,issuccess: constants.success, message: returnlangmsg.VerificationCodeSent, data: userObj});
                    }
                    else
                    {
                        return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.mailNotSend, data: {}});
                    }
                }
            });
        }
});

/* Sent 6 Digit Code on Email for Forgot Password */
router.post('/verify-forgot-password', [
        body('emailtoken').notEmpty().withMessage(constants.emailtokenValRequired).isLength({ min: 6,max: 6 }).withMessage(constants.emailtokenValRequired1)
    ], async function(req,res){
        var lang = req.body.lang;
        var returnlangmsg = returnMsg(lang);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            let reserrmsg = convertErrrmsg(errors.array(),lang);
            return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: reserrmsg, data: {}});
        } else {
            await User.findOne({ emailtoken: req.body.emailtoken }, async function (err, user) {
                if (err) {
                    // Add Log Data
                    requestBody = JSON.stringify(req.body);
                    logger.error(req.url,requestBody,err);
                    return res.send({status: returnlangmsg.serverStatus,issuccess: constants.error, message: returnlangmsg.serverMessage, data: {}});
                } else if (!user) {
                    return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.emailNotExists, data:{}});
                } else if (user.isverified == 0) {
                    return res.send({status: returnlangmsg.userDeactivatedStatus,issuccess: constants.error, message: returnlangmsg.userNotVerify, data: {}});
                } else if (user.active == 0) {
                    return res.send({status: returnlangmsg.userDeactivatedStatus,issuccess: constants.error, message: returnlangmsg.userNotActive, data: []});
                } else {
                    const userObj = createUsersObject(user);
                    return res.send({status: returnlangmsg.successStatus,issuccess: constants.success, message: returnlangmsg.userVerifySuccessfully, data:userObj});
                }
            });
        }
});

/* Set New Updated Password */
router.post('/set-new-password', [
        body('password').notEmpty().withMessage(constants.pwdValRequired).isLength({ min: 8 }).withMessage(constants.pwdValRequired1)
    ], async function(req,res){
        var lang = req.body.lang;
        var returnlangmsg = returnMsg(lang);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            let reserrmsg = convertErrrmsg(errors.array(),lang);
            return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: errors.array(), data: {}});
        } else {
            User.findOne({ emailtoken: req.body.emailtoken }, async function (err, user) {
                if (err) {
                    // Add Log Data
                    requestBody = JSON.stringify(req.body);
                    logger.error(req.url,requestBody,err);
                    return res.send({status: returnlangmsg.serverStatus,issuccess: constants.error, message: returnlangmsg.serverMessage, data: {}});
                } else if (!user) {
                    return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: returnlangmsg.emailNotExists, data:{}});
                } else if (user.isverified == 0) {
                    return res.send({status: returnlangmsg.userDeactivatedStatus,issuccess: constants.error, message: returnlangmsg.userNotVerify, data: {}});
                } else if (user.active == 0) {
                    return res.send({status: returnlangmsg.userDeactivatedStatus,issuccess: constants.error, message: returnlangmsg.userNotActive, data: []});
                } else if (req.body.emailtoken == "") {
                    return res.send({status: returnlangmsg.serverStatus,issuccess: constants.error, message: returnlangmsg.serverMessage, data: {}});
                } else {
                    let hashedPassword = await bcrypt.hashSync(req.body.password, 8);
                    user.password = req.body.password, //hashedPassword;
                    user.emailtoken = "";
                    user.tokenexpiretime = "";
                    await user.save();
                    user.password = "";
                    user.emailtoken = "";
                    user.tokenexpiretime = "";
                    const userObj = await createUsersObject(user);
                    return res.send({status: returnlangmsg.successStatus,issuccess: constants.success, message: returnlangmsg.passwordUpdatesuccess, data:userObj});
                }
            });
        }
});

/* Create a Video test */
router.post('/addvideo',
    async function (req, res) {
        var lang = req.body.lang;
        var returnlangmsg = returnMsg(lang);
        // Serverside Validation error
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            let reserrmsg = convertErrrmsg(errors.array(),lang);
            return res.send({status: returnlangmsg.errorStatus,issuccess: constants.error, message: reserrmsg, data: {}});
        } else {
            let videoReqObj = {
                code: req.body.code,
                video_url: req.body.video_url,
                title: req.body.title,
                is_active: req.body.is_active,
                updated_time: req.body.updated_time,
                created_time: req.body.created_time,
                img_url: req.body.img_url
            }
            await Video.create(videoReqObj, async function (err, video) {
                if (err) {
                    requestBody = JSON.stringify(req.body);
                    logger.error(req.url,requestBody,err);
                    return res.send({status: returnlangmsg.serverStatus,issuccess: constants.error, message: returnlangmsg.serverMessage, data: {}});
                } else {
                    const videoObj = await createVideosObject(video);
                    return res.send({status: returnlangmsg.successStatus,issuccess: constants.success, message: returnlangmsg.userRegisterSuccessfully, data: videoObj});
                }
            });
        }
    }
);

router.post('/getvideos', async function (req, res) {
    var recordsPerPage = req.body.recordsPerPage !== undefined && req.body.recordsPerPage !== '' ? req.body.recordsPerPage : 12;
    var recordsOffset = req.body.recordsOffset !== undefined && req.body.recordsOffset !== '' ? req.body.recordsOffset : 0;
    //final data object
    var data = {};
    var condition = {};
    var allcount = {};
    var options = {};
    options.skip = parseInt(recordsOffset);
    options.limit = parseInt(recordsPerPage);
    condition.is_active = 1;
    await Video.countDocuments(condition).exec(async function (err,count){
        allcount = count;
        await async.parallel([
            function (cb) {
                //get videos as per condition
                Video.find(condition)
                    .skip(options.skip)
                    .limit(options.limit)
                    .exec(function (err, videoList) {
                        if (err) {
                            var err = {
                                message: "Oops! something went wrong, please try again later."
                            };
                            cb(err);
                        } else {
                            data = videoList;
                            cb(null);
                        }
                    });
            },
        ], function (err) {
            //get final result and send the response to API.
            if (err) {
                res.json(err);
            } else {
                res.json({
                    data: data,
                    allcount : allcount
                });
            }
        });
    });
});


/* Get User Ip Address and Switch Language */
router.post('/checklang', async function(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.send({status: constants.errorStatus,issuccess: constants.error, message: errors.array(), data: {}});
    } else {

        // User Ip Address
        var ip = req.headers['x-forwarded-for'] ||
                req.connection.remoteAddress ||
                req.socket.remoteAddress ||
                (req.connection.socket ? req.connection.socket.remoteAddress : null);
        var ips = ip.split(",");
        ip = ips[0].trim();    //last one
        // var ip = "207.97.227.239"; //EN
        // var ip = "175.45.176.0";  //KO
        // var ip = "40.81.182.111";  //JP
        // console.log(ip);
        // var geo = await geoip.lookup(ip);
        // var country = geo.country;
        var country = req.headers['cf-ipcountry'];
        //country = "US";
        console.log(country);
        var lang = "EN";
        if (country == "KP" || country == "KR" || country == "KO") {
            lang = "KO";
        } else if (country == "JP") {
            lang = "JP";
        } else if (country == "CN") {
            lang = "ZH";
        }
        // var lngs = req.i18n.changeLanguage(lang); // will not load that!!! assert it was preloaded
        // var exists = req.i18n.exists('myKey')
        // var translation = req.t('myKey')
        return res.send({status: constants.successStatus,issuccess: constants.success, message: ip, data: lang, lang: lang, ip: ip});
    }
}
);

module.exports = router;

/* This Function is Use for Send Rendom OTP to User's Email Id for Verify Account */
function randomOtp(argument) {
    var numbers = "0123456789";
    var chars= "acdefhiklmnoqrstuvwxyz";
    var code_length = 6;
    var number_count = 3;
    var letter_count = 3;
    var code = '';
    for(var i=0; i < code_length; i++) {
        var letterOrNumber = Math.floor(Math.random() * 2);
        if((letterOrNumber == 0 || number_count == 0) && letter_count > 0) {
            letter_count--;
            var rnum = Math.floor(Math.random() * chars.length);
            code += chars[rnum];
        }
        else {
            number_count--;
            var rnum2 = Math.floor(Math.random() * numbers.length);
            code += numbers[rnum2];
        }
    }
    return code;
}

function resetpwdOtp(){
    return Math.floor(100000 + Math.random() * 900000);
}

/* Consatnt for Language Change */
function returnMsg(lang) {
    if (lang == "") { lanf = "EN"; } else { lang = lang; }
    if (lang=="EN") {
        langs = {
                    "successStatus" : 200,
                    "errorStatus" : 400,
                    "errorStatusAuthorize" : 401,
                    "errorAuthorize" : 403,
                    "serverStatus" : 500,
                    "success": "success",
                    "error": "error",
                    "serverMessage" : "Something Went Wrong, Please Try Again!",
                    "authenticationFailed" : "Your Authentication Failed, Please Try Again!",
                    "tokenDecodeError" : "Your Authentication Token Wrong, Please Try Again!",
                    "accessDenied" : "Access Denied, Please Try Again!",
                    "emailValRequired" : "Email Field is Required.",
                    "emailValRequired1" : "Please Enter valid Email Address.",
                    "pwdValRequired" : "Password Field is Required.",
                    "pwdValRequired1" : "Please Enter atleast minimum 8 Digit Password.",
                    "emailInvalid" : "Please Enter Valid Email Address!",
                    "emailExists" : "This Email Id is Already Registered with us, Please Enter New Email Id!",
                    "userRegisterSuccessfully" : "We will Sent Verification Link to Registered Email Id, Please Verify your Account!",
                    "userNotActive" : "Your Account was Inactive, Please Contact to Admin!",
                    "userDeactivatedStatus" : 501,
                    "userNotVerify" : "Your Account was not Verified, Please Verify!",
                    "passwordIncorrect" : "Your Password is not Match with Our Data, Please Try Again!",
                    "emailNotExists" : "Email Not Exists in our Database!",
                    "unknownSource" : "Request is from Unknown Source, Please Try Again!",
                    "userLoggedInSuccessfully" : "Login Successfully!",
                    "badRequest" : "Bad Request, Please Try Again!",
                    "userNotExists" : "User Not Found in Our system, Please Try Again!",
                    "userVerifySuccessfully" : "Your account is activated. Please log in now.",
                    "mailNotSend" : "Verification Code Not Sent on Email, Please Try Again!",
                    "VerificationCodeSent" : "Verification Code Sent on Your Email, Please check Your Email!",
                    "emailtokenValRequired" : "Verification Code Field is Required.",
                    "emailtokenValRequired1" : "Verification Code Length is 6 Digit Required.",
                    "passwordUpdatesuccess" : "Your Password was Update Successfully, Please Login!",
                    "googleCaptchaError": "Please Verify Google Re-Captcha.",
                    "googleCaptchaServerError": "Google Re-Captcha Verification Failed.",
                    "googleCaptchaServerSuccess": "Google Re-Captcha Verification Successfully.",
                    "mailfrom1" : "PMDB account",
                    "mailsubject1" : 'Verify your PMDB account',
                    "mailsubject2" : "PMDB account password reset code"
                };
    }
    else
    {
        langs = {
                    "successStatus" : 200,
                    "errorStatus" : 400,
                    "errorStatusAuthorize" : 401,
                    "errorAuthorize" : 403,
                    "serverStatus" : 500,
                    "success": "??????",
                    "error": "??????",
                    "serverMessage" : "????????? ??????????????????. ?????? ??????????????????!",
                    "authenticationFailed" : "????????? ??????????????????. ?????? ??????????????????!",
                    "tokenDecodeError" : "?????? ????????? ?????????????????????. ?????? ??????????????????!",
                    "accessDenied" : "???????????? ?????????????????????. ?????? ??????????????????!",
                    "emailValRequired" : "????????? ????????? ???????????????.",
                    "emailValRequired1" : "????????? ????????? ????????? ??????????????????.",
                    "pwdValRequired" : "???????????? ????????? ???????????????.",
                    "pwdValRequired1" : "?????? 8 ?????? ??????????????? ???????????????.",
                    "emailInvalid" : "????????? ????????? ????????? ??????????????????!",
                    "emailExists" : "??? ????????? ID??? ?????? ???????????? ????????????. ??? ????????? ID??? ??????????????????!",
                    "userRegisterSuccessfully" : "?????? ??? ????????? ID??? ?????? ????????? ??????????????????. ????????? ??????????????????!",
                    "userNotActive" : "????????? ????????? ???????????????????????????. ??????????????? ??????????????????!",
                    "userDeactivatedStatus" : 501,
                    "userNotVerify" : "????????? ???????????? ???????????????. ??????????????????!",
                    "passwordIncorrect" : "????????? ????????? ?????? ???????????? ???????????? ????????????. ?????? ??????????????????!",
                    "emailNotExists" : "????????????????????? ???????????? ????????????!",
                    "unknownSource" : "????????? ??? ????????? ???????????????. ?????? ??????????????????!",
                    "userLoggedInSuccessfully" : "????????? ??????!",
                    "badRequest" : "????????? ???????????????. ?????? ??????????????????!",
                    "userNotExists" : "???????????? ????????????????????? ????????? ????????????. ?????? ??????????????????!",
                    "userVerifySuccessfully" : "????????? ????????? ????????? ???????????????. ?????? ????????? ?????????.",
                    "mailNotSend" : "???????????? ?????? ????????? ???????????? ???????????????. ?????? ??????????????????!",
                    "VerificationCodeSent" : "???????????? ?????? ????????? ?????????????????????. ???????????? ??????????????????!",
                    "emailtokenValRequired" : "?????? ?????? ????????? ???????????????.",
                    "emailtokenValRequired1" : "?????? ?????? ????????? 6 ???????????????.",
                    "passwordUpdatesuccess" : "????????? ??????????????? ???????????????????????????. ?????????????????????!",
                    "googleCaptchaError": "Google Re-Captcha??? ??????????????????.",
                    "googleCaptchaServerError": "Google Re-Captcha ????????? ??????????????????.",
                    "googleCaptchaServerSuccess": "Google Re-Captcha ????????? ??????????????????.",
                    "mailfrom1" : "PMDB account",
                    "mailsubject1" : 'PMDB ????????? ????????? ?????????',
                    "mailsubject2" : "PMDB ???????????? ????????? ??????"
                };
    }
    return langs;
}

function convertErrrmsg(message,lang) {
    let returnmsgerrs = [];
    let chnagemsg = '';
    for (var i = 0; i < message.length; i++) {
        let rtn = message[i].msg;
        if (lang == "EN") {
            if (rtn == "Email Field is Required.") {
                chnagemsg += "Email Field is Required."+"\n";
            }
            if (rtn == "Please Enter valid Email Address.") {
                chnagemsg += "Please Enter valid Email Address."+"\n";
            }
            if (rtn == "Password Field is Required.") {
                chnagemsg += "Password Field is Required."+"\n";
            }
            if (rtn == "Please Enter atleast minimum 8 Digit Password.") {
                chnagemsg += "Please Enter atleast minimum 8 Digit Password."+"\n";
            }
            if (rtn == "Verification Code Field is Required.") {
                chnagemsg += "Verification Code Field is Required."+"\n";
            }
            if (rtn == "Verification Code Length is 6 Digit Required.") {
                chnagemsg += "Verification Code Length is 6 Digit Required."+"\n";
            }
        }
        else
        {
            if (rtn == "Email Field is Required.") {
                chnagemsg += "????????? ????????? ???????????????."+"\n";
            }
            if (rtn == "Please Enter valid Email Address.") {
                chnagemsg += "????????? ????????? ????????? ??????????????????."+"\n";
            }
            if (rtn == "Password Field is Required.") {
                chnagemsg += "???????????? ????????? ???????????????."+"\n";
            }
            if (rtn == "Please Enter atleast minimum 8 Digit Password.") {
                chnagemsg += "?????? 8 ?????? ??????????????? ???????????????."+"\n";
            }
            if (rtn == "Verification Code Field is Required.") {
                chnagemsg += "?????? ?????? ????????? ???????????????."+"\n";
            }
            if (rtn == "Verification Code Length is 6 Digit Required.") {
                chnagemsg += "?????? ?????? ????????? 6 ???????????????."+"\n";
            }
        }

    }
    return chnagemsg = chnagemsg.substring(0, chnagemsg.length - 1);
}
