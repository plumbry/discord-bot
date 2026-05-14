const {
          : interaction.channel;

      await interaction.reply(
        `Scanning accepted teams (${requiredStreams} stream(s) required)...`
      );

      const teams =
        await getTeams(signupChannel);

      const submissions =
        await getStreamSubmissions(
          streamChannel
        );

      const missingTeams = [];

      for (const team of teams) {

        const teamStreams = new Set();

        for (const memberId of team.members) {
          const streams =
            submissions.get(memberId);

          if (!streams) continue;

          for (const stream of streams) {
            teamStreams.add(stream);
          }
        }

        const streamCount =
          teamStreams.size;

        if (
          streamCount < requiredStreams
        ) {
          missingTeams.push({
            number: team.number,
            count: streamCount
          });
        }
      }

      let message =
        `📺 **Team Stream Check**\n\n`;

      message += `Gamemode: ${
        gamemode === "squads"
          ? "Squads"
          : "Duos/Trios"
      }\n`;

      message +=
        `Required Streams Per Team: ${requiredStreams}\n\n`;

      if (missingTeams.length) {
        message +=
          `Teams Missing Streams (${missingTeams.length})\n\n`;

        for (const team of missingTeams) {
          message +=
            `Team ${team.number} (${team.count}/${requiredStreams})\n`;
        }
      } else {
        message +=
          `All accepted teams submitted enough streams.`;
      }

      await interaction.followUp(message);

    } catch (error) {
      console.error(
        "❌ teamstreamcheck error:",
        error
      );

      if (!interaction.replied) {
        await interaction.reply({
          content:
            "Something went wrong while running this command.",
          ephemeral: true
        });
      }
    }
  }
};