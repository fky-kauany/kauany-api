import mongoose, { Schema } from "mongoose";

const users = new Schema(
  {
    id: String,
    estudado: [Number],
    ownerId: String,
  },
  { _id: false },
);

export default mongoose.model("User", users);
