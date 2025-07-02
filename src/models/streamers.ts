import mongoose, { Schema } from "mongoose";

const schema = new Schema(
  {
    summoners: {
      type: [String],
      validate: {
        validator: function (array) {
          return Array.isArray(array) && new Set(array).size === array.length;
        },
        message: "Os summoners devem ser únicos dentro do array.",
      },
    },
    id: {
      type: String,
      unique: true,
      required: true,
    },
  },
  { _id: false },
);

const StreamerSchema = mongoose.model("Streamer", schema);

export { StreamerSchema };
