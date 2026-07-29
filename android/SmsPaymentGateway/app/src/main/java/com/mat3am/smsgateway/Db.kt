package com.mat3am.smsgateway

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

@Entity(tableName = "sms_events")
data class SmsEventEntity(
    @PrimaryKey val dedupeKey: String,
    val sender: String,
    val body: String,
    val receivedAt: Long,
    val status: String,
    val lastError: String? = null,
    val payloadJson: String,
    val attempts: Int = 0
)

@Dao
interface SmsEventDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(row: SmsEventEntity): Long

    @Query("UPDATE sms_events SET status=:status, lastError=:error, attempts=attempts+1 WHERE dedupeKey=:key")
    suspend fun mark(key: String, status: String, error: String?)

    @Query("SELECT * FROM sms_events WHERE status IN ('pending','failed') ORDER BY receivedAt ASC LIMIT 50")
    suspend fun pending(): List<SmsEventEntity>

    @Query("SELECT * FROM sms_events ORDER BY receivedAt DESC LIMIT 40")
    suspend fun recent(): List<SmsEventEntity>

    @Query("SELECT COUNT(*) FROM sms_events WHERE dedupeKey=:key")
    suspend fun countKey(key: String): Int
}

@Database(entities = [SmsEventEntity::class], version = 1, exportSchema = false)
abstract class AppDb : RoomDatabase() {
    abstract fun sms(): SmsEventDao

    companion object {
        @Volatile private var instance: AppDb? = null
        fun get(ctx: Context): AppDb =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(ctx.applicationContext, AppDb::class.java, "sms_gateway.db").build()
                    .also { instance = it }
            }
    }
}
