const mongoose = require('mongoose')
const Schema = mongoose.Schema;
import { Roles } from "../../../enums/roles.enum";
import { Status } from "../../../enums/status.enum";


const userSchema = new Schema({
    auth_type: {
        type: String,
        enum: ['GOOGLE', 'APPLE','NONE'],
        default: 'NONE',
    },
    apple_user_id: {type: String, required: false},
    device_id: {type: String, required: false},
    email: { type: String, unique: true, sparse: true },
    password: { type: String, required: false },
    firstname: {type: String, default: null},
    lastname: {type: String, default: null},
    image: {type: String, default: null},
  otp: { type: String, required: true },
  role: {
    type: String,
    enum: [Roles.USER, Roles.ADMIN, Roles.STAFF_JUNIOR, Roles.STAFF_SENIOR, Roles.AUDITOR],
    default: Roles.USER,
  },
    status: {
        type: String,
        enum : [Status.ACTIVE, Status.INACTIVE, Status.DELETED],
        default: Status.ACTIVE,
    },
    ai_limit: {
        dailyLimit: {
            type: Number,
            default: null, // null means use global limit
            min: 1
        },
        monthlyLimit: {
            type: Number,
            default: null, // null means use global limit
            min: 1
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
},  {timestamps: true})

const User = mongoose.model('User', userSchema);

export default User;