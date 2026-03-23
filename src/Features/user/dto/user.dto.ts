export class UserDTO {
        id: string 
        data: string 
        createdAt: Date

        constructor(data) {
          this.id = data.id;
          this.data = data.data;
          this.createdAt = data.createdAt;
           }

        }