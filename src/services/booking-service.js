const { default: axios } = require('axios');
const {BookingRepository} = require('../repository/index');
const {FLIGHT_SERVICE_PATH,USER_SERVICE_PATH} =require('../config/serverConfig');
const {publishMessage} = require('../utils/messageQueue');
const {REMINDER_BINDING_KEY} = require('../config/serverConfig');
const { ServiceError } = require('../utils/errors');
const services = require('.');

class BookingService{
    constructor(){
        this.bookingRepository= new BookingRepository();
    }
    async createBooking(data,channel){
        try {
            const flightId = data.flightId;
            let getflightrequestURL = `${FLIGHT_SERVICE_PATH}/api/v1/flights/${flightId}`;
            const response =await axios.get(getflightrequestURL);
            const flightData = response.data.data;
           
            if(data.noOfSeats > flightData.totalSeats){
                 throw new ServiceError(
                    'Something went wrong in booking process',
                    'Insufficient Seats',
                 );  
            }

            const priceOfFlight = flightData.price;
            const totalCost = priceOfFlight * data.noOfSeats;
            
            const bookingPayload = {...data,totalCost};
            const booking = await this.bookingRepository.create(bookingPayload);

            const updateFlightRequestUrl= `${FLIGHT_SERVICE_PATH}/api/v1/flights/${booking.flightId}`;
            await axios.patch(updateFlightRequestUrl,{totalSeats:flightData.totalSeats - booking.noOfSeats});

            const finalBooking= await this.bookingRepository.update(booking.id,{status:'Booked'});
            // getting User
            const userId = finalBooking.userId;
            console.log(userId);
            let getUserRequestUrl = `${USER_SERVICE_PATH}/api/v1/users/${userId}`;
            const user =  await axios.get(getUserRequestUrl);
            // getting airports
            
               let getdepartureAirportrequestURL = `${FLIGHT_SERVICE_PATH}/api/v1/airport/${flightData.departureAirportId}`;
                let getarivalAirportrequestURL = `${FLIGHT_SERVICE_PATH}/api/v1/airport/${flightData.arrivalAirportId}`;
              const departureAirport = (await axios.get(getdepartureAirportrequestURL)).data.data;
              const arrialAirport =(await axios.get(getarivalAirportrequestURL)).data.data;
             
           const payLoad = {
            data:{
                mailFrom:"airlineHelpline@gamil.com",
                mailTo:user.data.data.email,
                mailSubject:"Booking confirmation Mail",
                mailBody:`Dear user this is to inform you that your booking from ${departureAirport.name} to ${arrialAirport.name} at ${flightData. departureTime } is confirmed.
                Thank You`
            },
            service:'SEND_BASIC_MAIL'
           };
            publishMessage(channel,REMINDER_BINDING_KEY,JSON.stringify(payLoad));

            // add in queue to create a reminder ticket
            const departureDate = new Date(flightData.departureTime);
            const notificationTime = new Date(departureDate.getTime() - 2 * 60 * 60 * 1000);
           const ticketPayload={
            data:{
                subject:"Ticket Reminder Mail",
                content:`Dear user this is to remind you that you have a booking from ${departureAirport.name} to ${arrialAirport.name} at ${flightData.departureTime }.
                Thank You`,
                recepientEmail:user.data.data.email,
                notificationTime:notificationTime
            },
            service:'CREATE_TICKET',
           };
            publishMessage(channel,REMINDER_BINDING_KEY,JSON.stringify(ticketPayload));
           
            return finalBooking;
        } catch (error) {
            console.log(error);
            if(error.name =='ValidationError' || error.name =='Repository') throw error;
         throw new ServiceError();  
        }
    
    }

    async getBookingsByUser(userId){
        try{
            const bookings = await this.bookingRepository.getByUser(userId);
            return bookings;
        }catch(error){
            // keep backend error shape consistent with existing controller logic
            throw error;
        }
    }
}
module.exports = BookingService;