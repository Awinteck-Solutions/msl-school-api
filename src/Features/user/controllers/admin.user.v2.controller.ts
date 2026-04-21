import { Request, Response } from "express";
import User from "../schema/user.schema";
import { Roles } from "../../../enums/roles.enum";
import { encrypt } from "../../../helpers/tokenizer";
import getRandomInt from "../../../helpers/random";

export class AdminUserV2Controller {
  static async nonUserAuth(req: Request, res: Response) {
    const { firstname, lastname, email, auth_type, device_id, apple_user_id } =
      req.body;

    if (!auth_type) {
      return res
        .status(404)
        .json({ status: false, message: "missing fields {auth_type}" });
    }

    if (auth_type === "APPLE") {
      if (!apple_user_id) {
        return res.status(404).json({
          status: false,
          message: "APPLE LOGIN requires apple_user_id",
        });
      }

      return User.findOneAndUpdate(
        { apple_user_id, role: { $ne: Roles.USER } },
        { device_id },
        { upsert: false }
      )
        .then((value) => {
          if (!value) {
            return res.status(404).json({
              status: false,
              message: "User not found",
            });
          }

          const token = encrypt.generateToken({
            id: value._id,
            email: value.email,
            firstname: value.firstname,
            lastname: value.lastname,
            role: value.role,
            status: value.status,
          });

          return res.status(200).json({
            status: true,
            message:
              value.device_id !== device_id
                ? "You were logged out of previous device"
                : "Login success(apple)",
            user: { ...value.toObject(), token },
          });
        })
        .catch((error) => {
          return res.status(500).json({
            status: false,
            message: "System error",
            other: error,
          });
        });
    }

    if (auth_type === "GOOGLE") {
      if (!firstname || !email) {
        return res
          .status(404)
          .json({ status: false, message: "missing fields {firstname, email}" });
      }

      return User.findOneAndUpdate(
        { email, role: { $ne: Roles.USER } },
        { firstname, lastname, email, auth_type, device_id },
        { upsert: false, new: true }
      )
        .then((result) => {
          if (!result) {
            return res.status(404).json({
              status: false,
              message: "User not found",
            });
          }

          const token = encrypt.generateToken({
            id: result._id,
            email: result.email,
            firstname: result.firstname,
            lastname: result.lastname,
            role: result.role,
            status: result.status,
          });

          return res.status(200).json({
            status: true,
            message: "Login success(google)",
            user: { ...result.toObject(), token },
          });
        })
        .catch((error) => {
          return res.status(500).json({
            status: false,
            message: "System error",
            other: error,
          });
        });
    }

    return res.status(404).json({
      status: false,
      message: "Invalid auth_type",
    });
  }
  
  static async nonUsers(req: Request, res: Response) {
    try {
      const page =
        parseInt(req.query.page as string) > 0
          ? parseInt(req.query.page as string)
          : 1;
      const limit =
        parseInt(req.query.limit as string) > 0
          ? parseInt(req.query.limit as string)
          : 10000;
      const search = (req.query.search as string) || "";
      const status = (req.query.status as string) || "";
      const skip = (page - 1) * limit;

      const query: Record<string, unknown> = {
        role: { $ne: Roles.USER },
      };

      if (search) {
        query.$or = [
          { email: { $regex: search, $options: "i" } },
          { firstname: { $regex: search, $options: "i" } },
          { lastname: { $regex: search, $options: "i" } },
          {
            $expr: {
              $regexMatch: {
                input: { $concat: ["$firstname", " ", "$lastname"] },
                regex: search,
                options: "i",
              },
            },
          },
        ];
      }

      if (status) {
        query.status = status;
      }


      const [users, total] = await Promise.all([
        User.find(
          query,
          {
            _id: 1,
            email: 1,
            firstname: 1,
            lastname: 1,
            image: 1,
            status: 1,
            role: 1,
            createdAt: 1,
          }
        )
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        User.countDocuments(query),
      ]);

      const filteredUsers = users.filter((user: any) => user.role !== Roles.USER);
      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Users fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: {
          search: search || null,
          status: status || null,
          role: null,
        },
        response: filteredUsers,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error: error.message,
      });
    }
  }

  static async nonUserSingle(req: Request, res: Response) {
    const userID = req.params.id;
    if (!userID) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      User.findOne({ _id: userID, role: { $ne: Roles.USER } })
        .then((result) => {
          if (!result) {
            return res.status(404).json({
              status: false,
              message: "User not found",
            });
          }
          return res.status(200).json({
            status: true,
            message: "Users success",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Users failed",
            other: error,
          });
        });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }

  static async createNonUser(req: Request, res: Response) {
    try {
      const { firstname, lastname, email, role, status } = req.body;
      if (!email || !role) {
        return res.status(400).json({
          status: false,
          message: "email/role can't be empty",
        });
      }
      if (role === Roles.USER) {
        return res.status(400).json({
          status: false,
          message: "Role cannot be USER",
        });
      }

      const otp = getRandomInt(999, 9999);

      const user = User({
        firstname,
        lastname,
        email,
        otp,
        role,
        status,
      });

      user
        .save()
        .then((result) => {
          return res.status(201).json({
            status: true,
            message: "New User registered",
            user: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Unsuccessful registration",
            other: error,
          });
        });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error: error.message,
      });
    }
  }

  static async updateNonUser(req: Request, res: Response) {
    try {
      const { id, role } = req.body;
      if (!id) {
        return res.status(400).json({
          status: false,
          message: "Missing id",
        });
      }
      // if (role === Roles.USER) {
      //   return res.status(400).json({
      //     status: false,
      //     message: "Role cannot be USER",
      //   });
      // }

      const update = {
        firstname: req.body.firstname,
        lastname: req.body.lastname,
        email: req.body.email, 
        status: req.body.status,
        role: req.body.role,
      };

      const user = await User.findOneAndUpdate(
        { _id: id, role: { $ne: Roles.USER } },
        update,
        { new: true }
      );

      if (!user) {
        return res.status(404).json({
          status: false,
          message: "User not found(student not included)",
        });
      }

      return res.status(200).json({
        status: true,
        message: "User update success",
        response: user,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error: error.message,
      });
    }
  }

  static async deleteNonUser(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      User.deleteOne({ _id: id, role: { $ne: Roles.USER } })
        .then((result) => {
          if (result.deletedCount === 0) {
            return res.status(404).json({
              status: false,
              message: "User not found",
            });
          }
          return res.status(200).json({
            status: true,
            message: "User delete success",
          });
        })
        .catch(() => {
          return res.status(404).json({
            status: false,
            message: "User delete failed",
          });
        });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }

  static async allV2(req: Request, res: Response) {
    try {
      const page =
        parseInt(req.query.page as string) > 0
          ? parseInt(req.query.page as string)
          : 1;
      const limit =
        parseInt(req.query.limit as string) > 0
          ? parseInt(req.query.limit as string)
          : 10000;
      const search = (req.query.search as string) || "";
      const status = (req.query.status as string) || "";
      const skip = (page - 1) * limit;

      const query: Record<string, unknown> = {};

      if (search) {
        query.$or = [
          { email: { $regex: search, $options: "i" } },
          { firstname: { $regex: search, $options: "i" } },
          { lastname: { $regex: search, $options: "i" } },
          {
            $expr: {
              $regexMatch: {
                input: { $concat: ["$firstname", " ", "$lastname"] },
                regex: search,
                options: "i",
              },
            },
          },
        ];
      }

      if (status) {
        query.status = status;
      }

      const [users, total] = await Promise.all([
        User.find(
          query,
          { _id: 1, email: 1, firstname: 1, lastname: 1, image: 1, status: 1, createdAt: 1 }
        )
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        User.countDocuments(query),
      ]);

      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Users fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: {
          search: search || null,
          status: status || null,
        },
        response: users,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error: error.message,
      });
    }
  }

  static async single(req: Request, res: Response) {
    const userID = req.params.id;
    if (!userID) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      User.findOne({ _id: userID })
        .then((result) => {
          return res.status(200).json({
            status: true,
            message: "Users success",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Users failed",
            other: error,
          });
        });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }

  static async updateStatus(req: Request, res: Response) {
    const { status, id } = req.body;
    if (!id || !status) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      User.updateOne({ _id: id }, { status }, { upsert: false })
        .then(() => {
          return res.status(200).json({
            status: true,
            message: "User status update success",
          });
        })
        .catch(() => {
          return res.status(404).json({
            status: false,
            message: "User status update failed",
          });
        });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }
}
