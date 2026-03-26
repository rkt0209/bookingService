const { StatusCodes } = require('http-status-codes');
const {Booking}= require('../models/index');
const { ValidationError, AppError } = require('../utils/errors');

class BookingRepository{
    async create(data){
        try{
            const booking = await Booking.create(data);
            return booking;
        }
        catch(error){
            if(error.name=="SequelizeValidationError"){
                throw new ValidationError(error);
            }
            throw new AppError(
                    "Repository Error",
                    "Can not create booking",
                    "There qas some issue,try again later",
                    StatusCodes.INTERNAL_SERVER_ERROR
            )
        }

    }

    async getByUser(userId){
        try{
            const bookings = await Booking.findAll({
                where: { userId },
                order: [['id', 'DESC']]
            });
            return bookings;
        } catch (error){
            throw new AppError(
                "Repository Error",
                "Can not fetch bookings",
                "There qas some issue,try again later",
                StatusCodes.INTERNAL_SERVER_ERROR
            );
        }
    }

    async update(bookingId,data){
        try {
          const booking=  await Booking.findByPk(bookingId);
            
            if(data.status){
                booking.status = data.status;
            }
            await booking.save();
          
            return booking;
        } catch (error) {
            throw new AppError(
                    "Repository Error",
                    "Can not update booking",
                    "There qas some issue,try again later",
                    StatusCodes.INTERNAL_SERVER_ERROR
            )
        }
    }

    
}
module.exports = BookingRepository;