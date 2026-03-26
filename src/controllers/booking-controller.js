const { StatusCodes } = require('http-status-codes');
const {BookingService} = require('../services/index');

const bookingService = new BookingService();
class BookingController{
    

    async create (req,res){
    try {
        const channel = req.channel;
        const response = await bookingService.createBooking(req.body,channel);
       
        return res.status(StatusCodes.OK).json({
            message:"Succefully completed a Booking",
            success:true,
            data:response,
            err:{}
        })
    } catch (error) {

       return res.status(error.statusCode).json({
            message:error.message,
            success:false,
            data:{},
            err:error.explanation
        })
    }
    }

    async getByUser(req,res){
        try{
            const { userId } = req.params;
            const parsedUserId = parseInt(userId, 10);
            const response = await bookingService.getBookingsByUser(parsedUserId);
            return res.status(StatusCodes.OK).json({
                message:"Successfully fetched bookings for user",
                success:true,
                data:response,
                err:{}
            });
        }catch(error){
            return res.status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR).json({
                message:error.message || "Something went wrong while fetching bookings",
                success:false,
                data:{},
                err:error.explanation || error
            });
        }
    }
}

module.exports = BookingController