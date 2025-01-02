import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import Decimal from "decimal.js";
import {
  ActionRowBuilder,
  APIInteractionGuildMember,
  ButtonBuilder,
  ButtonStyle,
  Client,
  CommandInteraction,
  EmbedBuilder,
  GatewayIntentBits,
  Guild,
  GuildMember,
  GuildMemberRoleManager,
  REST,
  Role,
  RoleResolvable,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import "dotenv/config";
import express from "express";
import fs from "fs";
import http from "http";
import { scheduleJob } from "node-schedule";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { v4 } from "uuid";
import { Database } from "./types/supabase";

// Discord IDs to exclude from calculations
const EXCLUDED_USERS = ['abarat', 'rxx', 'yeshy.smol'].map(username => username.toLowerCase());

let projects: string[] = [];

/*
#############################################
#
# SUPABASE STUFF
#
#############################################
*/
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_KEY!;
const supabase = createClient<Database>(supabaseUrl, supabaseKey);

/*
#############################################
#
# DISCORD STUFF
#
#############################################
*/
const discordBotToken = process.env.DISCORD_BOT_TOKEN;
const channelId = "";
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Define permissioned roles
const ADMIN_ROLE_IDS = [
  "1230906668066406481",
  "1230195803877019718",
  "1230906465334853785",
  "1234239721165815818",
];

// New constants for role management
const WHITELIST_ROLE_ID = "1263470313300295751";
const MOOLALIST_ROLE_ID = "1263470568536014870";
const FREE_MINT_ROLE_ID = "1263470790314164325";
const MOOTARD_ROLE_ID = "1281979123534925967";

// Team-specific role thresholds interface
interface RoleThresholds {
  whitelist: number;
  moolalist: number;
  freeMint: number;
}

let winningTeamThresholds: RoleThresholds = {
  whitelist: 1000,  // Example value A
  moolalist: 500,   // Example value B
  freeMint: 200     // Example value C
};

let losingTeamThresholds: RoleThresholds = {
  whitelist: 800,   // Example value X
  moolalist: 400,   // Example value Y
  freeMint: 150     // Example value Z
};

// Helper function to check if user has admin role
function hasAdminRole(member: GuildMember | APIInteractionGuildMember | null) {
  if (
    member &&
    "roles" in member &&
    member.roles instanceof GuildMemberRoleManager
  ) {
    return member.roles.cache.some((role: Role) =>
      ADMIN_ROLE_IDS.includes(role.id)
    );
  }
  return false;
}

// Enhanced team points calculation
async function getFilteredTeamPoints() {
  const bullasPoints = await supabase.rpc("sum_points_for_team", { 
    team_name: "bullas" 
  }).not("discord_id", "in", EXCLUDED_USERS);

  const berasPoints = await supabase.rpc("sum_points_for_team", { 
    team_name: "beras" 
  }).not("discord_id", "in", EXCLUDED_USERS);

  return {
    bullas: bullasPoints.data ?? 0,
    beras: berasPoints.data ?? 0
  };
}

// New function to get top players
async function getTopPlayers(team: string, limit: number) {
  const { data, error } = await supabase
    .from("users")
    .select("discord_id, address, points")
    .eq("team", team)
    .not("discord_id", "in", EXCLUDED_USERS)
    .order("points", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

// Enhanced CSV creation with role columns
function createEnhancedCSV(data: any[], guild: Guild, includeDiscordId: boolean = false) {
  const header = includeDiscordId
    ? "discord_id,address,points,whitelist,moolalist,freemint\n"
    : "address,points,whitelist,moolalist,freemint\n";

  const content = data.map(user => {
    const member = guild.members.cache.get(user.discord_id);
    const hasWhitelist = member?.roles.cache.has(WHITELIST_ROLE_ID) || 
                        member?.roles.cache.has("WL_WINNER_ROLE_ID") ? "Y" : "N";
    const hasMoolaList = member?.roles.cache.has(MOOLALIST_ROLE_ID) || 
                        member?.roles.cache.has("ML_WINNER_ROLE_ID") ? "Y" : "N";
    const hasFreeMint = member?.roles.cache.has(FREE_MINT_ROLE_ID) ? "Y" : "N";

    return includeDiscordId
      ? `${user.discord_id},${user.address},${user.points},${hasWhitelist},${hasMoolaList},${hasFreeMint}`
      : `${user.address},${user.points},${hasWhitelist},${hasMoolaList},${hasFreeMint}`;
  }).join("\n");

  return header + content;
}

// New function to save CSV file
async function saveCSV(content: string, filename: string) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const tempDir = join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }
  const filePath = join(tempDir, filename);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// Updated roles function
async function updateRoles(guild: Guild) {
  console.log("Starting enhanced role update process...");
  
  // Get team totals to determine winning/losing team
  const teamPoints = await getTeamPoints();
  const winningTeam = teamPoints.bullas > teamPoints.beras ? 'bullas' : 'beras';
  
  // Fetch all role objects
  const whitelistRole = guild.roles.cache.get(WHITELIST_ROLE_ID);
  const moolalistRole = guild.roles.cache.get(MOOLALIST_ROLE_ID);
  const freeMintRole = guild.roles.cache.get(FREE_MINT_ROLE_ID);
  
  if (!whitelistRole || !moolalistRole || !freeMintRole) {
    console.error("One or more roles not found. Aborting role update.");
    return;
  }

  // Fetch all users with their points and team
  const { data: allPlayers, error } = await supabase
    .from("users")
    .select("discord_id, points, team")
    .not("discord_id", "is", null);

  if (error) {
    console.error("Error fetching players:", error);
    return;
  }

  console.log(`Processing roles for ${allPlayers.length} players...`);

  for (const player of allPlayers) {
    if (!player.discord_id || !player.team) continue;

    try {
      const member = await guild.members.fetch(player.discord_id);
      if (!member) continue;

      const thresholds = player.team === winningTeam 
        ? winningTeamThresholds 
        : losingTeamThresholds;

      // Remove all existing roles first
      await member.roles.remove([whitelistRole, moolalistRole, freeMintRole]);

      // Apply new roles based on points
      if (player.points >= thresholds.whitelist) {
        await member.roles.add(whitelistRole);
      }
      if (player.points >= thresholds.moolalist) {
        await member.roles.add(moolalistRole);
      }
      if (player.points >= thresholds.freeMint) {
        await member.roles.add(freeMintRole);
      }

      console.log(`Updated roles for user: ${player.discord_id}`);
    } catch (error) {
      console.error(`Error updating roles for user ${player.discord_id}:`, error);
    }
  }

  console.log("Role update process completed.");
}

// Updated function to get filtered leaderboard
async function getFilteredLeaderboard(limit: number = 10, team?: string) {
  const query = supabase
    .from("users")
    .select("discord_id, points, team")
    .not("discord_id", "is", null)
    .not("discord_id", "in", EXCLUDED_USERS);

  if (team) {
    query.eq("team", team);
  }

  const { data, error } = await query
    .order("points", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

// Wallet update handler
async function handleUpdateWallet(interaction: CommandInteraction) {
  const userId = interaction.user.id;
  const uuid = v4();

  // Check if user exists
  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("discord_id", userId)
    .single();

  if (userError) {
    await interaction.reply({
      content: "Error checking user data. Please try again later.",
      ephemeral: true
    });
    return;
  }

  if (!userData) {
    await interaction.reply({
      content: "You haven't linked a wallet yet. Please use /wankme first.",
      ephemeral: true
    });
    return;
  }

  // Create new token for wallet update
  const { error: tokenError } = await supabase
    .from("tokens")
    .insert({ token: uuid, discord_id: userId, used: false });

  if (tokenError) {
    await interaction.reply({
      content: "Error generating update token. Please try again later.",
      ephemeral: true
    });
    return;
  }

  const vercelUrl = `${process.env.VERCEL_URL}/update-wallet?token=${uuid}&discord=${userId}`;
  
  await interaction.reply({
    content: `To update your wallet address, please click this link:\n\n${vercelUrl}\n\nYour current wallet: \`${userData.address}\``,
    ephemeral: true
  });
}

// Improve the cron job scheduling
const roleUpdateJob = scheduleJob("0 */6 * * *", async () => {
  console.log("Running scheduled role update job...");
  const guild = client.guilds.cache.get("1228994421966766141");
  if (guild) {
    await updateRoles(guild);
    console.log("Scheduled role update completed");
  } else {
    console.error("Guild not found for scheduled role update");
  }
});

// Define your commands
const commands = [
  new SlashCommandBuilder()
    .setName("updateroles")
    .setDescription("Manually update roles"),
  new SlashCommandBuilder()
    .setName("transfer")
    .setDescription("Transfer points to another user")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to transfer points to")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("The amount of points to transfer")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("wankme")
    .setDescription("Link your Discord account to your address"),
  new SlashCommandBuilder()
    .setName("moola")
    .setDescription("Check your moola balance"),
  new SlashCommandBuilder()
    .setName("team")
    .setDescription("Choose your team"),
  new SlashCommandBuilder()
    .setName("warstatus")
    .setDescription("Check the current war status"),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the leaderboard"),
  new SlashCommandBuilder()
    .setName("snapshot")
    .setDescription("Take a snapshot of the current standings"),
  new SlashCommandBuilder()
    .setName("fine")
    .setDescription("Fine a user")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to fine")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("The amount to fine")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("updatewhitelistminimum")
    .setDescription("Update the whitelist minimum")
    .addIntegerOption((option) =>
      option
        .setName("minimum")
        .setDescription("The new minimum value")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('updatewallet')
    .setDescription('Update your connected wallet address'),
];

client.once("ready", async () => {
  console.log("Bot is ready!");

  // Register slash commands
  const rest = new REST({ version: "10" }).setToken(discordBotToken!);

  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(Routes.applicationCommands(client.user!.id), {
      body: commands,
    });

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error("Error refreshing application (/) commands:", error);
  }
});

// Main command handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === "updateroles") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();
    const guild = interaction.guild;
    if (guild) {
      await updateRoles(guild);
      await interaction.editReply("Roles have been manually updated.");
    } else {
      await interaction.editReply("Failed to update roles: Guild not found.");
    }
  }
  if (interaction.commandName === "transfer") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const userId = interaction.user.id;
    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.get("amount")?.value as number;

    if (!targetUser || !amount) {
      await interaction.reply("Please provide a valid user and amount.");
      return;
    }

    const { data: senderData, error: senderError } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", userId)
      .single();

    if (senderError || !senderData) {
      console.error("Error fetching sender:", senderError);
      await interaction.reply("An error occurred while fetching the sender.");
      return;
    }

    if (senderData.points < amount) {
      await interaction.reply("Insufficient points to transfer.");
      return;
    }

    const { data: receiverData, error: receiverError } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", targetUser.id)
      .single();

    if (receiverError) {
      console.error("Error fetching receiver:", receiverError);
      await interaction.reply("An error occurred while fetching the receiver.");
      return;
    }

    if (!receiverData) {
      await interaction.reply("The specified user does not exist.");
      return;
    }

    const senderPoints = new Decimal(senderData.points);
    const receiverPoints = new Decimal(receiverData.points);
    const transferAmount = new Decimal(amount);

    const updatedSenderPoints = senderPoints.minus(transferAmount);
    const updatedReceiverPoints = receiverPoints.plus(transferAmount);

    const { error: senderUpdateError } = await supabase
      .from("users")
      .update({ points: updatedSenderPoints.toNumber() })
      .eq("discord_id", userId);

    if (senderUpdateError) {
      console.error("Error updating sender points:", senderUpdateError);
      await interaction.reply("An error occurred while updating sender points.");
      return;
    }

    const { error: receiverUpdateError } = await supabase
      .from("users")
      .update({ points: updatedReceiverPoints.toNumber() })
      .eq("discord_id", targetUser.id);

    if (receiverUpdateError) {
      console.error("Error updating receiver points:", receiverUpdateError);
      await interaction.reply("An error occurred while updating receiver points.");
      return;
    }

    await interaction.reply(
      `Successfully transferred ${amount} points to <@${targetUser.id}>.`
    );
  }

  if (interaction.commandName === "wankme") {
    const userId = interaction.user.id;
    const uuid = v4();

    const { data: userData } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", userId)
      .single();

    if (userData) {
      await interaction.reply(
        `You have already linked your account. Your linked account: \`${userData.address}\``
      );
      return;
    }

    const { error } = await supabase
      .from("tokens")
      .insert({ token: uuid, discord_id: userId, used: false })
      .single();

    if (error) {
      console.error("Error inserting token:", error);
      await interaction.reply({
        content: "An error occurred while generating the token.",
        ephemeral: true,
      });
    } else {
      const vercelUrl = `${process.env.VERCEL_URL}/game?token=${uuid}&discord=${userId}`;
      await interaction.reply({
        content: `Hey ${interaction.user.username}, to link your Discord account to your address click this link: \n\n${vercelUrl} `,
        ephemeral: true,
      });
    }
  }

  if (interaction.commandName === "moola") {
    const userId = interaction.user.id;

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", userId)
      .single();

    if (error) {
      console.error("Error fetching user:", error);
      await interaction.reply("An error occurred while fetching the user.");
    } else {
      const moolaEmbed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle(`${interaction.user.username}'s moola`)
        .setDescription(`You have ${data.points} moola. 🍯`)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setTimestamp();

      await interaction.reply({
        embeds: [moolaEmbed],
      });
    }
  }

  if (interaction.commandName === "team") {
    const userId = interaction.user.id;
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", userId)
      .single();

    if (userError || !userData) {
      await interaction.reply({
        content: "You need to link your account first. Please use the `/wankme` command to get started.",
        ephemeral: true,
      });
      return;
    }

    if (userData.team) {
      await interaction.reply({
        content: `You have already joined the ${userData.team} team. You cannot change your team.`,
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Choose Your Team")
      .setDescription(
        "Are you a bulla or a bera? Click the button to choose your team and get the corresponding role."
      )
      .setColor("#0099ff");

    const bullButton = new ButtonBuilder()
      .setCustomId("bullButton")
      .setLabel("🐂 Bullas")
      .setStyle(ButtonStyle.Primary);

    const bearButton = new ButtonBuilder()
      .setCustomId("bearButton")
      .setLabel("🐻 Beras")
      .setStyle(ButtonStyle.Primary);

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      bullButton,
      bearButton
    );

    await interaction.reply({
      embeds: [embed],
      components: [actionRow as any],
    });
  }

  if (interaction.commandName === "warstatus") {
    try {
      const teamPoints = await getFilteredTeamPoints();

      const embed = new EmbedBuilder()
        .setTitle("🏆 Moola War Status")
        .setDescription("Current team standings (excluding admin accounts)")
        .addFields(
          {
            name: "🐂 Bullas",
            value: `${teamPoints.bullas.toLocaleString()} mL`,
            inline: true
          },
          {
            name: "🐻 Beras",
            value: `${teamPoints.beras.toLocaleString()} mL`,
            inline: true
          }
        )
        .setColor("#FF0000")
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error("Error fetching war status:", error);
      await interaction.reply(
        "An error occurred while fetching the war status."
      );
    }
  }

  if (interaction.commandName === "leaderboard") {
    try {
      const data = await getFilteredLeaderboard(10);

      const leaderboardEmbed = new EmbedBuilder()
        .setTitle("🏆 Moola Leaderboard")
        .setColor("#FFD700");

      for (const [index, entry] of data.entries()) {
        const user = await client.users.fetch(entry.discord_id as string);
        const userMention = user ? `<@${user.id}>` : "Unknown User";

        leaderboardEmbed.addFields({
          name: `${index + 1}. ${user.username}`,
          value: ` 🍯 ${entry.points} mL`,
          inline: false,
        });
      }

      await interaction.reply({ embeds: [leaderboardEmbed] });
    } catch (error) {
      console.error("Error handling leaderboard command:", error);
      await interaction.reply(
        "An error occurred while processing the leaderboard command."
      );
    }
  }

  if (interaction.commandName === "snapshot") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const teamPoints = await getTeamPoints();
      const winningTeam = teamPoints.bullas > teamPoints.beras ? "bullas" : "beras";
      const losingTeam = winningTeam === "bullas" ? "beras" : "bullas";

      const winningTopPlayers = await getTopPlayers(winningTeam, 2000);
      const losingTopPlayers = await getTopPlayers(losingTeam, 700);
      const allPlayers = await getTopPlayers(winningTeam, Number.MAX_SAFE_INTEGER);
      allPlayers.push(...(await getTopPlayers(losingTeam, Number.MAX_SAFE_INTEGER)));
      allPlayers.sort((a, b) => b.points - a.points);

      if (!interaction.guild) {
        await interaction.editReply("Error: Could not find guild.");
        return;
      }

      const winningCSV = createEnhancedCSV(winningTopPlayers, interaction.guild);
      const losingCSV = createEnhancedCSV(losingTopPlayers, interaction.guild);
      const allCSV = createEnhancedCSV(allPlayers, interaction.guild, true);

      const winningFile = await saveCSV(winningCSV, `top_2000_${winningTeam}.csv`);
      const losingFile = await saveCSV(losingCSV, `top_700_${losingTeam}.csv`);
      const allFile = await saveCSV(allCSV, `all_players.csv`);

      await interaction.editReply({
        content: `Here are the snapshot files:`,
        files: [winningFile, losingFile, allFile],
      });

      // Delete temporary files
      fs.unlinkSync(winningFile);
      fs.unlinkSync(losingFile);
      fs.unlinkSync(allFile);
    } catch (error) {
      console.error("Error handling snapshot command:", error);
      await interaction.editReply(
        "An error occurred while processing the snapshot command."
      );
    }
  }

  if (interaction.commandName === "fine") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.get("amount")?.value as number;

    if (!targetUser || !amount || amount <= 0) {
      await interaction.reply("Please provide a valid user and a positive amount.");
      return;
    }

    try {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("discord_id", targetUser.id)
        .single();

      if (userError || !userData) {
        await interaction.reply("User not found or an error occurred.");
        return;
      }

      const currentPoints = new Decimal(userData.points);
      const fineAmount = new Decimal(amount);

      if (currentPoints.lessThan(fineAmount)) {
        await interaction.reply("The user doesn't have enough points for this fine.");
        return;
      }

      const updatedPoints = currentPoints.minus(fineAmount);

      const { error: updateError } = await supabase
        .from("users")
        .update({ points: updatedPoints.toNumber() })
        .eq("discord_id", targetUser.id);

      if (updateError) {
        throw new Error("Failed to update user points");
      }

      await interaction.reply(
        `Successfully fined <@${targetUser.id}> ${amount} points. Their new balance is ${updatedPoints} points.`
      );
    } catch (error) {
      console.error("Error handling fine command:", error);
      await interaction.reply("An error occurred while processing the fine command.");
    }
  }

  if (interaction.commandName === "updatewhitelistminimum") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const newMinimum = interaction.options.get("minimum")?.value as number;
    if (!newMinimum || newMinimum <= 0) {
      await interaction.reply("Please provide a valid positive integer for the new minimum.");
      return;
    }

    const teamOption = interaction.options.getString("team");
    const roleOption = interaction.options.getString("role");

    if (teamOption === "winning") {
      if (roleOption === "whitelist") winningTeamThresholds.whitelist = newMinimum;
      else if (roleOption === "moolalist") winningTeamThresholds.moolalist = newMinimum;
      else if (roleOption === "freemint") winningTeamThresholds.freeMint = newMinimum;
    } else if (teamOption === "losing") {
      if (roleOption === "whitelist") losingTeamThresholds.whitelist = newMinimum;
      else if (roleOption === "moolalist") losingTeamThresholds.moolalist = newMinimum;
      else if (roleOption === "freemint") losingTeamThresholds.freeMint = newMinimum;
    }

    await interaction.reply(`Role threshold updated to ${newMinimum} MOOLA.`);

    // Trigger an immediate role update
    const guild = interaction.guild;
    if (guild) {
      await updateRoles(guild);
      await interaction.followUp("Roles have been updated based on the new minimum.");
    }
  }

  if (interaction.commandName === "updatewallet") {
    await handleUpdateWallet(interaction);
  }
});

// Handle button interactions for team selection
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.member || !interaction.guild) return;

  const BULL_ROLE_ID = "1230207362145452103";
  const BEAR_ROLE_ID = "1230207106896892006";
  const member = interaction.member as GuildMember;
  const roles = member.roles;

  const bullRole = interaction.guild.roles.cache.get(BULL_ROLE_ID);
  const bearRole = interaction.guild.roles.cache.get(BEAR_ROLE_ID);
  const mootardRole = interaction.guild.roles.cache.get(MOOTARD_ROLE_ID);

  if (!bearRole || !bullRole || !mootardRole) return;

  async function removeRolesAndAddTeam(teamRole: Role, teamName: string) {
    // Remove the Mootard role
    if (roles.cache.has(MOOTARD_ROLE_ID)) {
      await roles.remove(mootardRole as RoleResolvable);
    }

    // Remove the opposite team role if present
    const oppositeRoleId =
      teamRole.id === BULL_ROLE_ID ? BEAR_ROLE_ID : BULL_ROLE_ID;
    if (roles.cache.has(oppositeRoleId)) {
      await roles.remove(oppositeRoleId === BULL_ROLE_ID ? bullRole : bearRole);
    }

    // Add the new team role
    await roles.add(teamRole);

    // Update the user's team in the database
    const { error } = await supabase
      .from("users")
      .update({ team: teamName })
      .eq("discord_id", interaction.user.id);

    if (error) {
      console.error(`Error updating user team to ${teamName}:`, error);
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: `An error occurred while joining the ${teamName} team. Please try again.`,
          ephemeral: true,
        });
      }
      return false;
    }

    return true;
  }

  if (interaction.customId === "bullButton") {
    if (await removeRolesAndAddTeam(bullRole, "bullas")) {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: "You have joined the Bullas team!",
          ephemeral: true,
        });
      }
    }
  } else if (interaction.customId === "bearButton") {
    if (await removeRolesAndAddTeam(bearRole, "beras")) {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: "You have joined the Beras team!",
          ephemeral: true,
        });
      }
    }
  }

  // Delete the original message
  if (interaction.message) {
    await interaction.message.delete();
  }
});

// Add this function to handle new member joins
client.on("guildMemberAdd", async (member) => {
  const mootardRole = member.guild.roles.cache.get(MOOTARD_ROLE_ID);
  if (mootardRole) {
    await member.roles.add(mootardRole);
    console.log(`Added Mootard role to new member: ${member.user.tag}`);
  }
});

client.login(discordBotToken);

/*
#############################################
#
# REST SERVER
#
#############################################
*/
const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);

const PORT = process.env.PORT || 3003;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});