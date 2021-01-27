CREATE DATABASE `baubles` /*!40100 DEFAULT CHARACTER SET utf8 */;
CREATE TABLE `resource_dependencies` (
  `resource_id` varchar(18) NOT NULL,
  `resource_name` varchar(255) NOT NULL,
  `resource_type` varchar(45) NOT NULL,
  `dependent_id` varchar(45) NOT NULL,
  `dependent_name` varchar(255) NOT NULL,
  `dependent_type` varchar(45) NOT NULL,
  KEY `id_idx` (`resource_id`,`dependent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
CREATE TABLE `resource_owners` (
  `id` varchar(128) NOT NULL,
  `name` varchar(128) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id_UNIQUE` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
CREATE TABLE `resources` (
  `id` varchar(18) NOT NULL,
  `type` varchar(45) NOT NULL,
  `name` varchar(128) NOT NULL,
  `attributes` varchar(255) DEFAULT NULL,
  `owner_id` varchar(128) NOT NULL,
  `created` datetime NOT NULL,
  `updated` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id_UNIQUE` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
