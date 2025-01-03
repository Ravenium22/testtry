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
  ButtonInteraction,
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

// -------------------
// Configuration
// -------------------

// Discord IDs of the users you want to exclude
const EXCLUDED_USERS = ['649377665496776724', '534027215973646346', '144683637718122496'];

let projects: string[] = [];

// -------------------
// Supabase Setup
// -------------------
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_KEY!;
const supabase = createClient<Database>(supabaseUrl, supabaseKey);

// -------------------
// Discord Setup
// -------------------
const discordBotToken = process.env.DISCORD_BOT_TOKEN!;
const channelId = ""; // Define your channel ID if needed
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
const ITEMS_PER_PAGE = 10;
const WHITELIST_ROLE_ID = "1263470313300295751";
const MOOLALIST_ROLE_ID = "1263470568536014870";
const FREE_MINT_ROLE_ID = "1263470790314164325";
const MOOTARD_ROLE_ID = "1281979123534925967";
const ML_WINNER_ROLE_ID = "1267532607491407933";
const BULL_ROLE_ID = "1230207362145452103";
const BEAR_ROLE_ID = "1230207106896892006";
const WL_WINNER_ROLE_ID = "1264963781419597916";

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

// -------------------
// Helper Functions
// -------------------

// Helper function to apply multiple 'not.eq' filters
function applyNotEqualFilters(query: any, column: string, values: string[]) {
  values.forEach(value => {
    query = query.not(column, 'eq', value);
  });
  return query;
}

function maskWalletAddress(address: string): string {
  if (!address) return '';
  if (address.length < 6) return address;
  return `${address.slice(0, 2)}...${address.slice(-4)}`;
}

function capitalizeFirstLetter(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Enhanced team points calculation
async function getFilteredTeamPoints() {
  try {
    console.log('Fetching Bullas team members excluding EXCLUDED_USERS...');
    let bullasQuery = supabase
      .from('users')
      .select('points')
      .eq('team', 'bullas')
      .not('discord_id', 'is', null);
    
    bullasQuery = applyNotEqualFilters(bullasQuery, 'discord_id', EXCLUDED_USERS);

    const { data: bullasUsers, error: bullasError } = await bullasQuery;

    if (bullasError) {
      console.error('Error fetching Bullas users:', bullasError);
      throw bullasError;
    }

    console.log(`Fetched ${bullasUsers?.length} Bullas team members.`);

    console.log('Fetching Beras team members excluding EXCLUDED_USERS...');
    let berasQuery = supabase
      .from('users')
      .select('points')
      .eq('team', 'beras')
      .not('discord_id', 'is', null);
    
    berasQuery = applyNotEqualFilters(berasQuery, 'discord_id', EXCLUDED_USERS);

    const { data: berasUsers, error: berasError } = await berasQuery;

    if (berasError) {
      console.error('Error fetching Beras users:', berasError);
      throw berasError;
    }

    console.log(`Fetched ${berasUsers?.length} Beras team members.`);

    const bullas = bullasUsers?.reduce((acc, user) => acc + (user.points || 0), 0) || 0;
    const beras = berasUsers?.reduce((acc, user) => acc + (user.points || 0), 0) || 0;

    console.log(`Total Bullas Points: ${bullas}, Total Beras Points: ${beras}`);

    return { bullas, beras };
  } catch (error) {
    console.error('Error in getFilteredTeamPoints:', error);
    throw error;
  }
}

// New function to get top players
async function getTopPlayers(team: string, limit: number) {
  try {
    console.log(`Fetching top ${limit} players for team ${team} excluding EXCLUDED_USERS...`);
    let query = supabase
      .from('users')
      .select('discord_id, address, points')
      .eq('team', team)
      .not('discord_id', 'is', null);
    
    query = applyNotEqualFilters(query, 'discord_id', EXCLUDED_USERS);

    const { data, error } = await query
      .order('points', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error(`Error fetching top players for team ${team}:`, error);
      throw error;
    }

    console.log(`Fetched ${data?.length} top players for team ${team}.`);
    return data;
  } catch (error) {
    console.error('Error in getTopPlayers:', error);
    throw error;
  }
}

interface UserData {
  discord_id: string;
  address: string;
  points: number;
  team?: string;
}

// Enhanced CSV creation with role columns
function createEnhancedCSV(data: any[], guild: Guild, includeDiscordId: boolean = false) {
  const header = includeDiscordId
    ? "discord_id,address,points,whitelist,moolalist,freemint\n"
    : "address,points,whitelist,moolalist,freemint\n";

  const content = data.map(user => {
    const member = guild.members.cache.get(user.discord_id);
    const address = user.address ? maskWalletAddress(user.address) : ''; // Handle possibly null address
    
    // Check for both regular and winner roles
    const hasWhitelist = member?.roles.cache.has(WHITELIST_ROLE_ID) || 
                        member?.roles.cache.has(WL_WINNER_ROLE_ID) ? "Y" : "N";
    
    const hasMoolaList = member?.roles.cache.has(MOOLALIST_ROLE_ID) || 
                        member?.roles.cache.has(ML_WINNER_ROLE_ID) ? "Y" : "N";
    
    const hasFreeMint = member?.roles.cache.has(FREE_MINT_ROLE_ID) ? "Y" : "N";

    return includeDiscordId
      ? `${user.discord_id},${address},${user.points},${hasWhitelist},${hasMoolaList},${hasFreeMint}`
      : `${address},${user.points},${hasWhitelist},${hasMoolaList},${hasFreeMint}`;
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
  const teamPoints = await getFilteredTeamPoints();
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

    // Exclude users
    if (EXCLUDED_USERS.includes(player.discord_id)) continue;

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
  try {
    console.log('Preparing leaderboard query...');
    let query = supabase
      .from('users')
      .select('discord_id, points, team')
      .not('discord_id', 'is', null);
    
    query = applyNotEqualFilters(query, 'discord_id', EXCLUDED_USERS);

    if (team && team !== "all") {
      query = query.eq('team', team);
    }

    const { data, error } = await query
      .order('points', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching leaderboard:', error);
      throw error;
    }

    console.log('Leaderboard data fetched successfully.');
    return data;
  } catch (error) {
    console.error('Error in getFilteredLeaderboard:', error);
    throw error;
  }
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

// Team command handler
async function handleTeamCommand(interaction: CommandInteraction) {
  if (!interaction.guild) return;
  const userId = interaction.user.id;

  // Check if user has linked wallet
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
      content: "You need to link your wallet first! Use /wankme to get started.",
      ephemeral: true
    });
    return;
  }

  const member = interaction.member as GuildMember;
  
  // Check current roles
  const hasBullRole = member.roles.cache.has(BULL_ROLE_ID);
  const hasBearRole = member.roles.cache.has(BEAR_ROLE_ID);

  // If user has either role but no team in DB (rejoining case)
  if ((hasBullRole || hasBearRole) && !userData.team) {
    const teamRole = hasBullRole ? "bullas" : "beras";
    const roleId = hasBullRole ? BULL_ROLE_ID : BEAR_ROLE_ID;
    
    // Update team in database
    const { error: updateError } = await supabase
      .from("users")
      .update({ team: teamRole })
      .eq("discord_id", userId);

    if (updateError) {
      await interaction.reply({
        content: "Error updating your team. Please try again later.",
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: `Welcome back! You've been reconnected to the ${teamRole} team!`,
      ephemeral: true
    });
    return;
  }

  // If user has a team in DB but lost roles (rejoining case)
  if (userData.team && !hasBullRole && !hasBearRole) {
    const roleId = userData.team === "bullas" ? BULL_ROLE_ID : BEAR_ROLE_ID;
    const role = interaction.guild.roles.cache.get(roleId);

    if (!role) {
      await interaction.reply({
        content: "Error finding team role. Please contact an admin.",
        ephemeral: true
      });
      return;
    }

    try {
      await member.roles.add(role);
      await interaction.reply({
        content: `Welcome back! Your ${userData.team} role has been restored!`,
        ephemeral: true
      });
      return;
    } catch (error) {
      console.error("Error restoring role:", error);
      await interaction.reply({
        content: "Error restoring your team role. Please contact an admin.",
        ephemeral: true
      });
      return;
    }
  }

  // If user already has team and roles (normal case)
  if (userData.team) {
    await interaction.reply({
      content: `You are already on team ${userData.team}!`,
      ephemeral: true
    });
    return;
  }

  // New user case - show team selection buttons
  const bullButton = new ButtonBuilder()
    .setCustomId("bullButton")
    .setLabel("🐂 Bullas")
    .setStyle(ButtonStyle.Primary);

  const bearButton = new ButtonBuilder()
    .setCustomId("bearButton")
    .setLabel("🐻 Beras")
    .setStyle(ButtonStyle.Primary);

  const actionRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(bullButton, bearButton);

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("Choose Your Team")
    .setDescription("Are you a **Bullas** or a **Beras**? Select your team below!");

  await interaction.reply({
    embeds: [embed],
    components: [actionRow],
    ephemeral: true
  });
}

// Leaderboard command handler
async function handleLeaderboard(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;

  try {
    const team = interaction.options.getString("team") || "all";
    const page = interaction.options.getInteger("page") || 1;
    const offset = (page - 1) * ITEMS_PER_PAGE;

    // Fetch total count for pagination
    let countQuery = supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .not('discord_id', 'is', null);

    // Fetch data for current page
    let dataQuery = supabase
      .from('users')
      .select('discord_id, points, team')
      .not('discord_id', 'is', null);

    // Apply team filter if specified
    if (team !== "all") {
      countQuery = countQuery.eq('team', team);
      dataQuery = dataQuery.eq('team', team);
    }

    // Apply excluded users filter
    EXCLUDED_USERS.forEach(userId => {
      countQuery = countQuery.neq('discord_id', userId);
      dataQuery = dataQuery.neq('discord_id', userId);
    });

    // Execute both queries
    const [countResult, dataResult] = await Promise.all([
      countQuery,
      dataQuery
        .order('points', { ascending: false })
        .range(offset, offset + ITEMS_PER_PAGE - 1)
    ]);

    if (countResult.error || dataResult.error) {
      throw new Error(countResult.error?.message || dataResult.error?.message);
    }

    const totalCount = countResult.count || 0;
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
    const data = dataResult.data || [];

    // Create embed
    const leaderboardEmbed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(`🏆 ${team === 'all' ? 'Overall' : capitalizeFirstLetter(team)} Leaderboard`)
      .setFooter({ text: `Page ${page} of ${totalPages} • Total Players: ${totalCount}` });

    // Add fields for each player
    for (const [index, entry] of data.entries()) {
      const position = offset + index + 1;
      try {
        const user = await client.users.fetch(entry.discord_id as string);
        leaderboardEmbed.addFields({
          name: `${position}. ${user.username}`,
          value: `🍯 ${entry.points.toLocaleString()} mL${team === 'all' ? ` (${capitalizeFirstLetter(entry.team)})` : ''}`,
          inline: false
        });
      } catch (err) {
        console.error(`Error fetching user ${entry.discord_id}:`, err);
      }
    }

    // Add navigation buttons if there are multiple pages
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (totalPages > 1) {
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`leaderboard_first_${team}`)
            .setLabel('⏮ First')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 1),
          new ButtonBuilder()
            .setCustomId(`leaderboard_prev_${team}`)
            .setLabel('◀ Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 1),
          new ButtonBuilder()
            .setCustomId(`leaderboard_next_${team}`)
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === totalPages),
          new ButtonBuilder()
            .setCustomId(`leaderboard_last_${team}`)
            .setLabel('Last ⏭')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === totalPages)
        );
      components.push(row);
    }

    await interaction.reply({
      embeds: [leaderboardEmbed],
      components,
      ephemeral: false
    });

  } catch (error) {
    console.error('Error handling leaderboard command:', error);
    await interaction.reply({
      content: 'An error occurred while fetching the leaderboard.',
      ephemeral: true
    });
  }
}

// New function to handle leaderboard page updates via buttons
async function handleLeaderboardPage(interaction: ButtonInteraction, team: string, page: number) {
  try {
    const offset = (page - 1) * ITEMS_PER_PAGE;

    // Fetch total count for pagination
    let countQuery = supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .not('discord_id', 'is', null);

    // Fetch data for current page
    let dataQuery = supabase
      .from('users')
      .select('discord_id, points, team')
      .not('discord_id', 'is', null);

    // Apply team filter if specified
    if (team !== "all") {
      countQuery = countQuery.eq('team', team);
      dataQuery = dataQuery.eq('team', team);
    }

    // Apply excluded users filter
    EXCLUDED_USERS.forEach(userId => {
      countQuery = countQuery.neq('discord_id', userId);
      dataQuery = dataQuery.neq('discord_id', userId);
    });

    // Execute both queries
    const [countResult, dataResult] = await Promise.all([
      countQuery,
      dataQuery
        .order('points', { ascending: false })
        .range(offset, offset + ITEMS_PER_PAGE - 1)
    ]);

    if (countResult.error || dataResult.error) {
      throw new Error(countResult.error?.message || dataResult.error?.message);
    }

    const totalCount = countResult.count || 0;
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
    const data = dataResult.data || [];

    // Create embed
    const leaderboardEmbed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(`🏆 ${team === 'all' ? 'Overall' : capitalizeFirstLetter(team)} Leaderboard`)
      .setFooter({ text: `Page ${page} of ${totalPages} • Total Players: ${totalCount}` });

    // Add fields for each player
    for (const [index, entry] of data.entries()) {
      const position = offset + index + 1;
      try {
        const user = await client.users.fetch(entry.discord_id as string);
        leaderboardEmbed.addFields({
          name: `${position}. ${user.username}`,
          value: `🍯 ${entry.points.toLocaleString()} mL${team === 'all' ? ` (${capitalizeFirstLetter(entry.team)})` : ''}`,
          inline: false
        });
      } catch (err) {
        console.error(`Error fetching user ${entry.discord_id}:`, err);
      }
    }

    // Add navigation buttons if there are multiple pages
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (totalPages > 1) {
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`leaderboard_first_${team}`)
            .setLabel('⏮ First')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 1),
          new ButtonBuilder()
            .setCustomId(`leaderboard_prev_${team}`)
            .setLabel('◀ Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 1),
          new ButtonBuilder()
            .setCustomId(`leaderboard_next_${team}`)
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === totalPages),
          new ButtonBuilder()
            .setCustomId(`leaderboard_last_${team}`)
            .setLabel('Last ⏭')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === totalPages)
        );
      components.push(row);
    }

    await interaction.update({
      embeds: [leaderboardEmbed],
      components
    });

  } catch (error) {
    console.error('Error handling leaderboard page:', error);
    await interaction.reply({
      content: 'An error occurred while updating the leaderboard.',
      ephemeral: true
    });
  }
}

// -------------------
// Schedule Role Updates
// -------------------
const ENABLE_ROLE_UPDATES = false; // Set this to false during testing

if (ENABLE_ROLE_UPDATES) {
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
}

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
    .setDescription("View the leaderboard")
    .addStringOption(option =>
      option
        .setName("team")
        .setDescription("Filter by team")
        .addChoices(
          { name: 'All Teams', value: 'all' },
          { name: 'Bullas', value: 'bullas' },
          { name: 'Beras', value: 'beras' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName("page")
        .setDescription("Page number")
        .setMinValue(1)
    ),
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
    )
    .addStringOption((option) =>
      option
        .setName("team")
        .setDescription("The team to update (winning/losing)")
        .addChoices(
          { name: 'Winning Team', value: 'winning' },
          { name: 'Losing Team', value: 'losing' }
        )
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("role")
        .setDescription("The role to update")
        .addChoices(
          { name: 'Whitelist', value: 'whitelist' },
          { name: 'Moolalist', value: 'moolalist' },
          { name: 'Free Mint', value: 'freemint' }
        )
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('updatewallet')
    .setDescription('Update your connected wallet address'),
].map(command => command.toJSON());

// Register slash commands on ready
client.once("ready", async () => {
  console.log("Bot is ready!");

  // Register slash commands
  const rest = new REST({ version: "10" }).setToken(discordBotToken);

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

// Main interaction handler
client.on("interactionCreate", async (interaction) => {
  if (interaction.isCommand()) {
    switch (interaction.commandName) {
      case "team":
        await handleTeamCommand(interaction);
        break;
      case "updateroles":
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
        break;

      case "transfer":
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
        break;

      case "wankme":
        const wankmeUserId = interaction.user.id;
        const uuid = v4();

        const { data: wankmeUserData, error: wankmeUserError } = await supabase
          .from("users")
          .select("*")
          .eq("discord_id", wankmeUserId)
          .single();

        if (wankmeUserError) {
          await interaction.reply({
            content: "Error checking user data. Please try again later.",
            ephemeral: true
          });
          return;
        }

        if (wankmeUserData) {
          await interaction.reply(
            `You have already linked your account. Your linked account: \`${maskWalletAddress(wankmeUserData.address)}\``
          );
          return;
        }

        const { error: wankmeTokenError } = await supabase
          .from("tokens")
          .insert({ token: uuid, discord_id: wankmeUserId, used: false });

        if (wankmeTokenError) {
          console.error("Supabase Error:", wankmeTokenError);
          await interaction.reply({
            content: `Error: ${wankmeTokenError.message}`,
            ephemeral: true,
          });
        } else {
          const vercelUrl = `${process.env.VERCEL_URL}/game?token=${uuid}&discord=${wankmeUserId}`;
          await interaction.reply({
            content: `Hey ${interaction.user.username}, to link your Discord account to your address click this link: \n\n${vercelUrl} `,
            ephemeral: true,
          });
        }
        break;

      case "moola":
        const moolaUserId = interaction.user.id;

        const { data: moolaData, error: moolaError } = await supabase
          .from("users")
          .select("*")
          .eq("discord_id", moolaUserId)
          .single();

        if (moolaError) {
          console.error("Error fetching user:", moolaError);
          await interaction.reply("An error occurred while fetching the user.");
        } else {
          const moolaEmbed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(`${interaction.user.username}'s moola`)
            .setDescription(`You have ${moolaData.points} moola. 🍯`)
            .setThumbnail(interaction.user.displayAvatarURL())
            .setTimestamp();

          await interaction.reply({
            embeds: [moolaEmbed],
          });
        }
        break;

      case "warstatus":
        try {
          console.log("Fetching war status data...");
          const teamPoints = await getFilteredTeamPoints();
          console.log(`Bullas Points: ${teamPoints.bullas}, Beras Points: ${teamPoints.beras}`);

          const warstatusEmbed = new EmbedBuilder()
            .setTitle("🏆 Moola War Status")
            .setDescription("Current team standings (excluding admin accounts)")
            .addFields(
              {
                name: "🐂 Bullas",
                value: `${teamPoints.bullas.toLocaleString()} mL`,
                inline: true,
              },
              {
                name: "🐻 Beras",
                value: `${teamPoints.beras.toLocaleString()} mL`,
                inline: true,
              }
            )
            .setColor("#FF0000")
            .setTimestamp();

          await interaction.reply({ embeds: [warstatusEmbed] });
          console.log("Warstatus command executed successfully.");
        } catch (error) {
          console.error("Error fetching war status:", error);
          await interaction.reply(
            "An error occurred while fetching the war status."
          );
        }
        break;

      case "leaderboard":
        await handleLeaderboard(interaction);
        break;

      case "snapshot":
        if (!hasAdminRole(interaction.member)) {
          await interaction.reply({
            content: "You don't have permission to use this command.",
            ephemeral: true,
          });
          return;
        }

        await interaction.deferReply();

        try {
          const teamPoints = await getFilteredTeamPoints();
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
        break;

      case "fine":
        if (!hasAdminRole(interaction.member)) {
          await interaction.reply({
            content: "You don't have permission to use this command.",
            ephemeral: true,
          });
          return;
        }

        const fineTargetUser = interaction.options.getUser("user");
        const fineAmount = interaction.options.get("amount")?.value as number;

        if (!fineTargetUser || !fineAmount || fineAmount <= 0) {
          await interaction.reply("Please provide a valid user and a positive amount.");
          return;
        }

        try {
          const { data: fineUserData, error: fineUserError } = await supabase
            .from("users")
            .select("*")
            .eq("discord_id", fineTargetUser.id)
            .single();

          if (fineUserError || !fineUserData) {
            await interaction.reply("User not found or an error occurred.");
            return;
          }

          const currentPoints = new Decimal(fineUserData.points);
          const fineDecimal = new Decimal(fineAmount);

          if (currentPoints.lessThan(fineDecimal)) {
            await interaction.reply("The user doesn't have enough points for this fine.");
            return;
          }

          const updatedPoints = currentPoints.minus(fineDecimal);

          const { error: fineUpdateError } = await supabase
            .from("users")
            .update({ points: updatedPoints.toNumber() })
            .eq("discord_id", fineTargetUser.id);

          if (fineUpdateError) {
            throw new Error("Failed to update user points");
          }

          await interaction.reply(
            `Successfully fined <@${fineTargetUser.id}> ${fineAmount} points. Their new balance is ${updatedPoints} points.`
          );
        } catch (error) {
          console.error("Error handling fine command:", error);
          await interaction.reply("An error occurred while processing the fine command.");
        }
        break;

      case "updatewhitelistminimum":
        if (!interaction.isChatInputCommand()) return;  // type guard
        
        if (!hasAdminRole(interaction.member)) {
          await interaction.reply({
            content: "You don't have permission to use this command.",
            ephemeral: true,
          });
          return;
        }

        const newMinimum = interaction.options.getInteger("minimum", true); // added true for required
        const updateTeam = interaction.options.getString("team", true); // added true for required
        const updateRole = interaction.options.getString("role", true); // added true for required

        if (newMinimum <= 0) {
          await interaction.reply("Please provide a valid positive integer for the new minimum.");
          return;
        }

        if (updateTeam === "winning") {
          if (updateRole === "whitelist") winningTeamThresholds.whitelist = newMinimum;
          else if (updateRole === "moolalist") winningTeamThresholds.moolalist = newMinimum;
          else if (updateRole === "freemint") winningTeamThresholds.freeMint = newMinimum;
        } else if (updateTeam === "losing") {
          if (updateRole === "whitelist") losingTeamThresholds.whitelist = newMinimum;
          else if (updateRole === "moolalist") losingTeamThresholds.moolalist = newMinimum;
          else if (updateRole === "freemint") losingTeamThresholds.freeMint = newMinimum;
        }

        await interaction.reply(`${updateTeam} team ${updateRole} threshold updated to ${newMinimum} MOOLA.`);

        const updateGuild = interaction.guild;
        if (updateGuild) {
          await updateRoles(updateGuild);
          await interaction.followUp("Roles have been updated based on the new minimum.");
        }
        break;

      case "updatewallet":
        await handleUpdateWallet(interaction);
        break;

      default:
        break;
    }
  } else if (interaction.isButton()) {
    const customId = interaction.customId;

    // Handle leaderboard pagination buttons
    if (customId.startsWith("leaderboard_")) {
      const parts = customId.split("_");
      const action = parts[1]; // first, prev, next, last
      const team = parts.slice(2).join("_"); // to handle teams with underscores

      // Extract current page from embed footer
      const embed = interaction.message.embeds[0];
      if (!embed || !embed.footer || !embed.footer.text) {
        await interaction.reply({ content: "Cannot determine the current page.", ephemeral: true });
        return;
      }

      const footerText = embed.footer.text;
      const match = footerText.match(/Page (\d+) of (\d+)/);
      if (!match) {
        await interaction.reply({ content: "Cannot parse pagination info.", ephemeral: true });
        return;
      }

      const currentPage = parseInt(match[1]);
      const totalPages = parseInt(match[2]);

      let newPage = currentPage;
      switch (action) {
        case "first":
          newPage = 1;
          break;
        case "prev":
          newPage = Math.max(currentPage - 1, 1);
          break;
        case "next":
          newPage = Math.min(currentPage + 1, totalPages);
          break;
        case "last":
          newPage = totalPages;
          break;
        default:
          break;
      }

      // Update the leaderboard with the new page
      await handleLeaderboardPage(interaction, team, newPage);
    }

    // Handle team selection buttons
    else if (customId === "bullButton" || customId === "bearButton") {
      const teamRoleId = customId === "bullButton" ? BULL_ROLE_ID : BEAR_ROLE_ID;
      const teamName = customId === "bullButton" ? "bullas" : "beras";
      const teamRole = interaction.guild.roles.cache.get(teamRoleId);

      if (!teamRole) {
        await interaction.reply({
          content: "Team role not found. Please contact an admin.",
          ephemeral: true,
        });
        return;
      }

      // Remove the Mootard role and opposite team role if present, then add the new team role
      try {
        const member = interaction.member as GuildMember;
        await member.roles.remove([MOOTARD_ROLE_ID]);

        const oppositeRoleId = teamRoleId === BULL_ROLE_ID ? BEAR_ROLE_ID : BULL_ROLE_ID;
        if (member.roles.cache.has(oppositeRoleId)) {
          await member.roles.remove(oppositeRoleId);
        }

        await member.roles.add(teamRole);

        // Update the user's team in the database
        const { error } = await supabase
          .from("users")
          .update({ team: teamName })
          .eq("discord_id", interaction.user.id);

        if (error) {
          console.error(`Error updating user team to ${teamName}:`, error);
          await interaction.reply({
            content: `An error occurred while joining the ${teamName} team. Please try again.`,
            ephemeral: true,
          });
          return;
        }

        await interaction.reply({
          content: `You have joined the ${capitalizeFirstLetter(teamName)} team!`,
          ephemeral: true,
        });

        // Delete the original message since we're sending a new one
        if (interaction.message.deletable) {
          await interaction.message.delete();
        }
      } catch (error) {
        console.error("Error handling team selection button:", error);
        await interaction.reply({
          content: "An error occurred while updating your team. Please try again.",
          ephemeral: true,
        });
      }
    }
  }
});

//  function to handle new member joins
client.on("guildMemberAdd", async (member) => {
  const mootardRole = member.guild.roles.cache.get(MOOTARD_ROLE_ID);
  if (mootardRole) {
    await member.roles.add(mootardRole);
    console.log(`Added Mootard role to new member: ${member.user.tag}`);
  }
});

// -------------------
// Login to Discord
// -------------------
client.on('error', error => {
  console.error('Discord client error:', error);
});

client.login(discordBotToken).then(() => {
  console.log('Successfully logged in to Discord!');
}).catch(error => {
  console.error('Failed to log in to Discord:', error);
});

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
