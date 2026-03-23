const mongoose = require('mongoose')
const Schema = mongoose.Schema;


const EnrolmentSchema = new Schema({
    data: { type: String, required: false },
    status: {
        type: String,
        enum : ['ACTIVE','DEACTIVE'],
        default: 'ACTIVE',
    },
},  {timestamps: true})

const Enrolment = mongoose.model('Enrolment', EnrolmentSchema);

export default Enrolment

       